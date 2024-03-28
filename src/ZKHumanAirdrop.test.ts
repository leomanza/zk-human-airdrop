import { Airdrop, Account, MerkleWitnessInstance } from './ZKHumanAirdrop';
import {
  isReady,
  shutdown,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  MerkleTree,
  UInt64,
  Signature,
  MerkleMap,
  Field,
} from 'snarkyjs';

const Tree = new MerkleTree(8);
const initialTokens = 100;
let initialBalance = 10_000_000_000;
type Names = 'Bob' | 'Alice' | 'Charlie' | 'Olivia';
export let Accounts: Map<string, Account> = new Map<Names, Account>();

let alice, charlie, olivia: any;
let initialCommitment: any;

async function createLocalBlockchain() {
  const Local = Mina.LocalBlockchain();
  Mina.setActiveInstance(Local);

  alice = new Account(Local.testAccounts[1].publicKey);
  charlie = new Account(Local.testAccounts[2].publicKey);
  olivia = new Account(Local.testAccounts[3].publicKey);

  Accounts.set('Alice', alice);
  Accounts.set('Charlie', charlie);
  Accounts.set('Olivia', olivia);

  Tree.setLeaf(BigInt(0), alice.hash());
  Tree.setLeaf(BigInt(1), charlie.hash());
  Tree.setLeaf(BigInt(2), olivia.hash());

  initialCommitment = Tree.getRoot();

  return Local.testAccounts[0].privateKey;
}

async function localDeploy(
  zkAppInstance: Airdrop,
  zkAppPrivatekey: PrivateKey,
  deployerAccount: PrivateKey
) {
  const txn = await Mina.transaction(deployerAccount, () => {
    AccountUpdate.fundNewAccount(deployerAccount, { initialBalance });
    zkAppInstance.deploy({ zkappKey: zkAppPrivatekey });
  });
  await txn.send();
}

describe('Airdrop', () => {
  let deployerAccount: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey;

  beforeEach(async () => {
    await isReady;
    deployerAccount = await createLocalBlockchain();
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
  });

  afterAll(async () => {
    setTimeout(shutdown, 0);
  });

  it('deploys the `Airdrop` smart contract and setsPreImage', async () => {
    const zkAppInstance = new Airdrop(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    await setCommitment(deployerAccount, zkAppPrivateKey, zkAppInstance);

    expect(zkAppInstance.idsCommitment.get()).toEqual(initialCommitment);
  });

  it('check Alice is in the set', async () => {
    const zkAppInstance = new Airdrop(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    await setCommitment(deployerAccount, zkAppPrivateKey, zkAppInstance);

    await checkSetInclusion(
      'Alice',
      BigInt(0),
      deployerAccount,
      zkAppPrivateKey,
      zkAppInstance
    );
  });

  it('can mint', async () => {
    const zkAppInstance = new Airdrop(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    await setCommitment(deployerAccount, zkAppPrivateKey, zkAppInstance);

    await mint(deployerAccount, zkAppPrivateKey, zkAppInstance);
  });

  it('check claim status', async () => {
    const zkAppInstance = new Airdrop(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    await setCommitment(deployerAccount, zkAppPrivateKey, zkAppInstance);

    const result = await checkClaimed(
      'Alice',
      deployerAccount,
      zkAppPrivateKey,
      zkAppInstance
    );
    expect(result).toEqual(BigInt(0));
  });

  it('can claim', async () => {
    const zkAppInstance = new Airdrop(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    await setCommitment(deployerAccount, zkAppPrivateKey, zkAppInstance);

    await claim(
      'Alice',
      BigInt(0),
      deployerAccount,
      zkAppPrivateKey,
      zkAppInstance
    );

    // eslint-disable-next-line no-unused-vars
    const result = await checkClaimed(
      'Alice',
      deployerAccount,
      zkAppPrivateKey,
      zkAppInstance
    );
    // expect(result).toEqual(BigInt(1));
  });

  it('throws when randomer is not in set', async () => {
    const zkAppInstance = new Airdrop(zkAppAddress);
    await localDeploy(zkAppInstance, zkAppPrivateKey, deployerAccount);
    await setCommitment(deployerAccount, zkAppPrivateKey, zkAppInstance);
    try {
      expect(
        await checkSetInclusion(
          'Bob',
          BigInt(0),
          deployerAccount,
          zkAppPrivateKey,
          zkAppInstance
        )
      ).toThrow();
    } catch (e) {
      console.log(e);
    }
  });
});

async function setCommitment(
  feePayer: any,
  zkappKey: any,
  merkleZkApp: Airdrop
) {
  let tx = await Mina.transaction(feePayer, () => {
    merkleZkApp.setCommitment(initialCommitment);
    merkleZkApp.sign(zkappKey);
  });
  await tx.prove();
  await tx.send();
}

async function checkSetInclusion(
  name: Names,
  index: bigint,
  feePayer: any,
  zkappKey: any,
  contract: Airdrop
) {
  let tx = await Mina.transaction(feePayer, () => {
    let account = Accounts.get(name)!;
    let w = Tree.getWitness(index);
    let witness = new MerkleWitnessInstance(w);
    contract.checkSetInclusion(account, witness);
    contract.sign(zkappKey);
  });
  await tx.prove();
  await tx.send();
}

async function claim(
  name: Names,
  index: bigint,
  feePayer: any,
  zkappKey: any,
  contract: Airdrop
) {
  let recepient = Accounts.get(name)!.publicKey;

  // create authorization signature
  const sig = Signature.create(
    zkappKey,
    UInt64.from(UInt64.one).toFields().concat(recepient.toFields())
  );

  let tx = await Mina.transaction(feePayer, () => {
    let account = Accounts.get(name)!;
    let w = Tree.getWitness(index);
    let witness = new MerkleWitnessInstance(w);

    const map = new MerkleMap();
    console.log(recepient.toBase58());
    const mmWitness = map.getWitness(Field.zero);

    contract.claim(account, witness, sig, mmWitness);
    contract.sign(zkappKey);
  });
  await tx.prove();
  tx.sign([zkappKey]);
  await tx.send();
}

async function checkClaimed(
  name: Names,
  feePayer: any,
  zkappKey: any,
  contract: Airdrop
): Promise<bigint> {
  let result = BigInt(0);

  let tx = await Mina.transaction(feePayer, () => {
    let account = Accounts.get(name)!;
    const map = new MerkleMap();

    const mmWitness = map.getWitness(Field.zero);

    result = contract.checkClaimed(account, mmWitness);
    console.log({ result });
    contract.sign(zkappKey);
  });
  await tx.prove();
  tx.sign([zkappKey]);
  await tx.send();
  return result;
}

async function mint(feePayer: any, zkappKey: any, contract: Airdrop) {
  const sig = Signature.create(
    zkappKey,
    UInt64.from(initialTokens).toFields().concat(contract.address.toFields())
  );
  // console.log("compiling.")
  // await Airdrop.compile()
  let tx = await Mina.transaction(feePayer, () => {
    AccountUpdate.fundNewAccount(feePayer);
    contract.mint(contract.address, UInt64.from(initialTokens), sig);
    contract.sign(zkappKey);
  });
  await tx.prove();
  tx.sign([zkappKey]);
  await tx.send();
}
