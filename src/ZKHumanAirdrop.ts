import {
  SmartContract,
  isReady,
  Poseidon,
  Field,
  Permissions,
  DeployArgs,
  State,
  state,
  CircuitValue,
  PublicKey,
  UInt64,
  prop,
  method,
  MerkleWitness,
  Signature,
  MerkleMapWitness,
} from 'snarkyjs';

let initialBalance = 10_000_000_000;
const tokenSymbol = 'BLDRNR';

export class Account extends CircuitValue {
  @prop publicKey: PublicKey;

  constructor(publicKey: PublicKey) {
    super(publicKey);
    this.publicKey = publicKey;
  }

  hash(): Field {
    return Poseidon.hash(this.toFields());
  }
}

await isReady;

export class MerkleWitnessInstance extends MerkleWitness(8) {}

export class MerkleAirdrop extends SmartContract {
  // off-chain torage identifier (id)
  @state(Field) identifier = State<Field>();

  // commitment is the root of the Merkle Tree
  @state(Field) commitment = State<Field>();

  // nullifiers are used to prevent double spending
  @state(Field) nullifiers = State<Field>();

  // total supply of tokens
  @state(UInt64) totalAmountInCirculation = State<UInt64>();

  deploy(args: DeployArgs) {
    super.deploy(args);

    const permissionToEdit = Permissions.signature();

    this.setPermissions({
      ...Permissions.default(),
      editState: Permissions.proofOrSignature(),
      setTokenSymbol: permissionToEdit,
      send: permissionToEdit,
      receive: permissionToEdit,
    });
    this.balance.addInPlace(UInt64.from(initialBalance));

    this.tokenSymbol.set(tokenSymbol);
    this.totalAmountInCirculation.set(UInt64.zero);
  }

  // token method
  @method mint(
    receiverAddress: PublicKey,
    amount: UInt64,
    adminSignature: Signature
  ) {
    let totalAmountInCirculation = this.totalAmountInCirculation.get();
    this.totalAmountInCirculation.assertEquals(totalAmountInCirculation);
    let newTotalAmountInCirculation = totalAmountInCirculation.add(amount);

    console.log('verifying signature');
    adminSignature
      .verify(
        this.address,
        amount.toFields().concat(receiverAddress.toFields())
      )
      .assertTrue();
    console.log('verified signature');

    this.token.mint({
      address: receiverAddress,
      amount,
    });
    console.log('minted!');
    this.totalAmountInCirculation.set(newTotalAmountInCirculation);
  }

  // token method
  @method sendTokens(
    senderAddress: PublicKey,
    receiverAddress: PublicKey,
    amount: UInt64
  ) {
    this.token.send({
      from: senderAddress,
      to: receiverAddress,
      amount,
    });
  }

  @method
  addHumanIdentifier(identifier: Field) {
    this.identifier.set(identifier);
  }

  @method
  checkHumanIdentifierInclusion(account: Account, path: MerkleMapWitness) {
    // we fetch the on-chain identifiers map
    let identifier = this.identifier.get();
    this.identifier.assertEquals(identifier);
    // we check that the account is within the identifiers Merkle Map
    // eslint-disable-next-line no-unused-vars
    const [rootBefore, key] = path.computeRootAndKey(Field.zero);
    console.log('key is ', key.toBigInt());
    return key.toBigInt();
  }

  // set initial merkle tree value
  @method
  setCommitment(preImage: Field) {
    this.commitment.set(preImage);
  }

  @method
  checkSetInclusion(account: Account, path: MerkleWitnessInstance) {
    // console.log('checkInclusion::checking inclusion for account', account.publicKey.toString());

    // we fetch the on-chain commitment
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);
    // we check that the account is within the committed Merkle Tree
    path.calculateRoot(account.hash()).assertEquals(commitment);
  }

  /// checks if an account has claimed, returns 0 if not claimed, 1 if claimed
  @method
  checkClaimed(account: Account, mmWitness: MerkleMapWitness): bigint {
    // ensure this account has not been claimed before
    let nullifiers = this.nullifiers.get();
    this.nullifiers.assertEquals(nullifiers);

    // eslint-disable-next-line no-unused-vars
    const [rootBefore, key] = mmWitness.computeRootAndKey(Field.zero);
    console.log('key is ', key.toBigInt());
    return key.toBigInt();
  }

  @method
  claim(
    account: Account,
    path: MerkleWitnessInstance,
    signature: Signature,
    mmWitness: MerkleMapWitness
  ) {
    // fetch the on-chain commitment
    let commitment = this.commitment.get();
    this.commitment.assertEquals(commitment);

    // check that the account is within the committed Merkle Tree
    path.calculateRoot(account.hash()).assertEquals(commitment);

    // ensure this account has not been claimed before
    let _nullifiers = this.nullifiers.get();
    this.nullifiers.assertEquals(_nullifiers);

    // eslint-disable-next-line no-unused-vars
    const [rootBefore, key] = mmWitness.computeRootAndKey(Field.zero);
    console.log(' nullifier root is', rootBefore.toString());
    key.assertEquals(Field.zero);
    // rootBefore.assertEquals(_nullifiers.getRoot());

    // compute the root after setting nullifier flag
    // eslint-disable-next-line no-unused-vars
    const [rootAfter, _] = mmWitness.computeRootAndKey(Field.one);

    console.log('setting nullifier root to', rootAfter.toString());

    // set the new root
    this.nullifiers.set(rootAfter);

    console.log({ signature });

    // now send tokens to the account
    // this.mint(account.publicKey, UInt64.one, signature);
  }
}
