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
const MERKLE_HEIGHT = 8;
export class MerkleWitnessInstance extends MerkleWitness(MERKLE_HEIGHT) {}

export class Airdrop extends SmartContract {
  @state(Field) idsCommitment = State<Field>();
  @state(Field) claimNullifiers = State<Field>();
  @state(Field) humansCommitment = State<Field>();
  @state(UInt64) totalSupply = State<UInt64>();

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
    this.totalSupply.set(UInt64.zero);
  }

  // token method
  @method mint(
    receiverAddress: PublicKey,
    amount: UInt64,
    adminSignature: Signature
  ) {
    let totalAmountInCirculation = this.totalSupply.get();
    this.totalSupply.assertEquals(totalAmountInCirculation);
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
    this.totalSupply.set(newTotalAmountInCirculation);
  }

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
    this.humansCommitment.set(identifier);
  }

  @method
  checkHumanIdentifierInclusion(account: Account, path: MerkleMapWitness) {
    // we fetch the on-chain identifiers map
    let identifier = this.humansCommitment.get();
    this.humansCommitment.assertEquals(identifier);
    // we check that the account is within the identifiers Merkle Map
    // eslint-disable-next-line no-unused-vars
    const [rootBefore, key] = path.computeRootAndKey(Field.zero);
    console.log('key is ', key.toBigInt());
    return key.toBigInt();
  }

  // set initial merkle tree value
  @method
  setCommitment(preImage: Field) {
    this.idsCommitment.set(preImage);
  }

  @method
  checkSetInclusion(account: Account, path: MerkleWitnessInstance) {
    // console.log('checkInclusion::checking inclusion for account', account.publicKey.toString());

    // we fetch the on-chain commitment
    let commitment = this.idsCommitment.get();
    this.idsCommitment.assertEquals(commitment);
    // we check that the account is within the committed Merkle Tree
    path.calculateRoot(account.hash()).assertEquals(commitment);
  }

  /// checks if an account has claimed, returns 0 if not claimed, 1 if claimed
  @method
  checkClaimed(account: Account, mmWitness: MerkleMapWitness): bigint {
    // ensure this account has not been claimed before
    let nullifiers = this.claimNullifiers.get();
    this.claimNullifiers.assertEquals(nullifiers);

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
    let commitment = this.idsCommitment.get();
    this.idsCommitment.assertEquals(commitment);

    // check that the account is within the committed Merkle Tree
    path.calculateRoot(account.hash()).assertEquals(commitment);

    // ensure this account has not been claimed before
    let _nullifiers = this.claimNullifiers.get();
    this.claimNullifiers.assertEquals(_nullifiers);

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
    this.claimNullifiers.set(rootAfter);

    console.log({ signature });

    // check account is verified Human
    // verified humans would receive higher rewards
    const amount = UInt64.from(1);
    // this.mint(account.publicKey, UInt64.one, signature);
  }
}
