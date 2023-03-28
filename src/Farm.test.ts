import {
  AccountUpdate,
  Circuit,
  Field,
  Signature,
  UInt32,
  UInt64,
} from 'snarkyjs';

import { Farm } from './Farm.js';
import describeContract from './describeContract.js';
import OffchainStateBackup from '@zkfs/contract-api/dist/offchainStateBackup.js';
import { Program, ProgramInput } from './zkProgram.js';
import { Key } from '@zkfs/contract-api';

describeContract<Farm>('farm', Farm, Program, (context) => {
  async function localDeploy() {
    const {
      deployerAccount,
      deployerKey,
      zkAppPrivateKey,
      zkApp,
      contractApi,
      token,
      senderAccount,
    } = context();

    Farm.tokenSmartContractAddress = token.address;

    const tx = await contractApi.transaction(
      zkApp,
      { sender: deployerAccount, fee: 1e9 },
      () => {
        AccountUpdate.fundNewAccount(deployerAccount, 2);
        zkApp.deploy();
        console.log(
          'zk app has token contract address',
          zkApp.tokenContract.address.toBase58()
        );
        token.approveAccountUpdate(zkApp.self);
        token.mint(senderAccount, UInt64.from(32));
      }
    );
    await tx.prove();

    // this tx needs .sign(), because `deploy()` adds an account update
    // that requires signature authorization
    await tx.sign([deployerKey, zkAppPrivateKey]).send();
    return tx;
  }

  it('dispatches 1 action and calls rollup on `Farm` smart contract', async () => {
    expect.assertions(2);

    const {
      senderAccount,
      senderKey,
      zkApp,
      contractApi,
      waitForNextBlock,
      fetchAccounts,
      fetchEventsZkApp,
      zkProgram,
      token,
      localBlockchain,
    } = context();

    const tx0 = await localDeploy();

    await waitForNextBlock();
    OffchainStateBackup.restoreLatest(zkApp);
    await fetchAccounts([senderAccount, zkApp.address]);

    const balance = token.balanceOf(senderAccount);
    Circuit.log('balance after mint should be 32', balance);

    console.log('Farm.deploy() successful, initial offchain state:', {
      offchainStateRootHash: zkApp.offchainStateRootHash.get().toString(),
      data: zkApp.virtualStorage?.data[zkApp.address.toBase58()],
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      tx: tx0.toPretty(),
    });

    console.log('Farm.deposit(), dispatching an action...');

    console.log('token id in zkApp', zkApp.token.id.toString());

    const startFarmTx = await contractApi.transaction(
      zkApp,
      { sender: senderAccount, fee: 1e9 },
      () => {
        zkApp.startFarm(senderAccount);
        token.approveAccountUpdate(zkApp.self);
      }
    );
    await startFarmTx.prove();
    await startFarmTx.sign([senderKey]).send();
    console.log('Farm.startFarm() successful', startFarmTx.toPretty());
    OffchainStateBackup.restoreLatest(zkApp);
    await waitForNextBlock();
    await fetchAccounts([senderAccount, zkApp.address]);

    const tx1 = await contractApi.transaction(
      zkApp,
      { sender: senderAccount, fee: 1e9 },
      () => {
        AccountUpdate.fundNewAccount(senderAccount);
        zkApp.deposit(senderAccount, UInt64.from(30));
      }
    );

    await tx1.prove();
    await tx1.sign([senderKey]).send();

    console.log('deposit', tx1.toPretty());

    // console.log({
    //   actions: JSON.stringify(
    //     localBlockchain.getActions(zkApp.address, zkApp.self.tokenId)[0],
    //     null,
    //     2
    //   ),
    // });

    OffchainStateBackup.restoreLatest(zkApp);
    const balanceAfterDeposit = token.balanceOf(senderAccount);
    Circuit.log(
      'balance after deposit should be 2 for sender',
      balanceAfterDeposit
    );

    const balanceZkAppAfterDepositDispatch = token.balanceOf(zkApp.address);
    Circuit.log(
      'balance after deposit should be 30 for zkApp',
      balanceZkAppAfterDepositDispatch
    );

    await waitForNextBlock();
    await waitForNextBlock();
    await fetchAccounts([senderAccount, zkApp.address]);
    console.log('Farm.rollup(), rolling up actions...', {
      delegators:
        zkApp.delegators.contract?.virtualStorage?.data[
          zkApp.address.toBase58()
        ],
    });

    Circuit.log('root hash before rollup', zkApp.offchainStateRootHash.get());

    const tx2 = await contractApi.transaction(
      zkApp,
      { sender: senderAccount, fee: 1e9 },
      () => {
        zkApp.rollup();
        token.approveAccountUpdate(zkApp.self);
      }
    );

    await tx2.prove();
    await tx2.sign([senderKey]).send();

    OffchainStateBackup.restoreLatest(zkApp);
    Circuit.log('root hash after rollup', zkApp.offchainStateRootHash.get());

    await waitForNextBlock();
    await fetchAccounts([senderAccount, zkApp.address]);
    console.log('Farm.rollup() successful, new offchain state:', {
      offchainStateRootHash: zkApp.offchainStateRootHash.get().toString(),
      data: zkApp.virtualStorage?.data[zkApp.address.toBase58()],
      deposit: zkApp.virtualStorage?.getSerializedValue(
        zkApp.address.toBase58(),
        Key.fromString('delegators').toString(),
        Farm.addressToKey(senderAccount).toString()
      ),
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      tx: tx2.toPretty(),
    });

    const farmData = zkApp.farmData.get();
    // expect(farmData.accumulatedRewardsPerShare.toString()).toEqual('753');
    expect(farmData.totalStakedBalance.toString()).toEqual('32');
    console.log('events', JSON.stringify(await fetchEventsZkApp(), null, 2));

    const programInput = new ProgramInput({
      permissionUntilBlockHeight: UInt32.from(10_000),
      publicKey: senderAccount,
      signature: Signature.create(senderKey, Field(0).toFields()),
    });
    // todo: find a way to compile the program only once
    await zkProgram.compile();
    const proof = await zkProgram.run(programInput);
    const newRewardPerBlock = UInt64.from(100);
    const tx3 = await contractApi.transaction(
      zkApp,
      { sender: senderAccount, fee: 1e9 },
      () => {
        zkApp.updateRewardsPerBlock(proof, newRewardPerBlock);
        token.approveAccountUpdate(zkApp.self);
      }
    );
    await tx3.prove();
    await tx3.sign([senderKey]).send();
    console.log('Farm.updateRewardsPerBlock() successful', tx3.toPretty());

    OffchainStateBackup.restoreLatest(zkApp);
    await waitForNextBlock();
    await fetchAccounts([senderAccount, zkApp.address]);
    expect(zkApp.rewardPerBlock.get()).toStrictEqual(newRewardPerBlock);
  }, 60_000_000);
});
