/* eslint-disable @typescript-eslint/prefer-readonly-parameter-types */
/* eslint-disable new-cap */
import {
  Key,
  OffchainState,
  offchainState,
  OffchainStateContract,
  OffchainStateMapRoot,
  withOffchainState,
} from '@zkfs/contract-api';
import { safeUint64Div, safeUint64Sub } from '@zkfs/safe-math';
import {
  Field,
  method,
  Reducer,
  State,
  state,
  Struct,
  UInt64,
  Permissions,
  PublicKey,
  Circuit,
  AccountUpdate,
  UInt32,
  Bool,
} from 'snarkyjs';

import { Action } from './actions/actions.js';
import { ProgramProof } from './zkProgram.js';

class DelegatorRecord extends Struct({
  accumulatedRewardPerShareStart: UInt64,
  balance: UInt64,
}) {}

class FarmData extends Struct({
  accumulatedRewardsPerShare: UInt64,
  totalStakedBalance: UInt64,
}) {}

export class Farm extends OffchainStateContract {
  override rollingStateOptions = {
    shouldEmitEvents: false,
    shouldEmitPrecondition: true,
    shouldEmitAccountUpdates: true,
  };

  events = {
    totalStakedBalance: UInt64,
    userReward: UInt64,
  };
  // should be 1_000_000, reduced for testing purposes
  public fixedPointAccuracy = UInt64.from(100);

  public defaultAdmin = PublicKey.from({ x: Field(0), isOdd: Bool(false) });

  public static addressToKey = (address: PublicKey): Key<PublicKey> =>
    Key.fromType<PublicKey>(PublicKey, address);

  // until snarkyjs fixes bug with state indexes in extended classes
  @state(Field) public placeholder = State<Field>();

  @state(Field) public actionsHash = State<Field>();

  @state(UInt64) public rewardPerBlock = State<UInt64>();

  @state(UInt32) public lastUpdate = State<UInt32>();

  @state(PublicKey) public admin = State<PublicKey>();

  // removed this for simplicity
  // @state(UInt64) public paid = State<UInt64>()
  // @state(UInt64) public totalBlocks = State<UInt64>();
  // @state(UInt64) public unpaid = State<UInt64>();

  public reducer = Reducer({ actionType: Action });

  @offchainState() public delegators = OffchainState.fromMap();

  @offchainState() public farmData = OffchainState.fromRoot<FarmData>(FarmData);

  @withOffchainState
  public init() {
    super.init();
    this.lastUpdate.set(UInt32.from(0));

    this.root.setRootHash(OffchainStateMapRoot.initialRootHash);
    this.actionsHash.set(Reducer.initialActionsHash);
    this.admin.set(this.defaultAdmin);

    // off-chain state
    this.rewardPerBlock.set(UInt64.from(5));
    this.delegators.setRootHash(OffchainStateMapRoot.initialRootHash);
    this.farmData.set(
      new FarmData({
        accumulatedRewardsPerShare: UInt64.from(3),
        totalStakedBalance: UInt64.from(2),
      })
    );

    this.account.permissions.set({
      ...Permissions.default(),
      editSequenceState: Permissions.proofOrSignature(),
      editState: Permissions.proofOrSignature(),
      send: Permissions.signature(),
    });
  }

  /*
   *  Setting the admin and lastUpdate to the current block height.
   *  This method can only be called once.
   */
  @method
  public startFarm(newAdmin: PublicKey) {
    // set admin
    const admin = this.admin.get();
    this.admin.assertEquals(admin);
    // ensure that startFarm can only be called once
    admin.assertEquals(this.defaultAdmin);
    this.admin.set(newAdmin);

    // set lastUpdate to current block height
    const lastUpdate = this.lastUpdate.get();
    this.lastUpdate.assertEquals(lastUpdate);

    const blockHeight = this.network.blockchainLength.get();
    this.network.blockchainLength.assertEquals(blockHeight);

    this.lastUpdate.set(blockHeight);
  }

  @method
  public updateRewardsPerBlock(proof: ProgramProof, newRewardPerBlock: UInt64) {
    proof.verify();

    const { permissionUntilBlockHeight } = proof.publicInput;
    const blockHeight = this.network.blockchainLength.get();
    this.network.blockchainLength.assertEquals(blockHeight);
    blockHeight.assertLessThan(permissionUntilBlockHeight);

    const rewardPerBlock = this.rewardPerBlock.get();
    this.rewardPerBlock.assertEquals(rewardPerBlock);
    this.rewardPerBlock.set(newRewardPerBlock);
  }

  public getDelegatorRecord(address: PublicKey): DelegatorRecord {
    const state = OffchainState.fromParent(
      this.root,
      DelegatorRecord,
      Farm.addressToKey(address)
    );
    state.contract = this;
    const defaultDelegatorRecord = new DelegatorRecord({
      accumulatedRewardPerShareStart: UInt64.from(0),
      balance: UInt64.from(0),
    });
    return state.getOrDefault(defaultDelegatorRecord);
  }

  public setDelegatorRecord(
    address: PublicKey,
    delegatorRecord: DelegatorRecord
  ) {
    const state = OffchainState.fromParent(
      this.root,
      DelegatorRecord,
      Farm.addressToKey(address)
    );
    state.contract = this;
    state.set(delegatorRecord);
  }

  @method
  @withOffchainState
  public deposit(address: PublicKey, amount: UInt64) {
    AccountUpdate.create(address).requireSignature();

    this.reducer.dispatch(Action.deposit(address, amount));
  }

  @method
  @withOffchainState
  public claim(address: PublicKey) {
    AccountUpdate.create(address).requireSignature();

    this.reducer.dispatch(Action.claim(address));
  }

  @method
  @withOffchainState
  public withdraw(address: PublicKey) {
    AccountUpdate.create(address).requireSignature();

    this.reducer.dispatch(Action.withdraw(address));
  }

  public createDelegatorRecord(accStart: UInt64, amount: UInt64) {
    return new DelegatorRecord({
      accumulatedRewardPerShareStart: accStart,
      balance: amount,
    });
  }

  public updatePoolWithRewards() {
    const lastUpdate = this.lastUpdate.get();
    this.lastUpdate.assertEquals(lastUpdate);

    const blockHeight = this.network.blockchainLength.get();
    this.network.blockchainLength.assertEquals(blockHeight);
    const multiplier = blockHeight.sub(lastUpdate);

    const rewardPerBlock = this.rewardPerBlock.get();
    this.rewardPerBlock.assertEquals(rewardPerBlock);
    const reward = multiplier.toUInt64().mul(rewardPerBlock);
    Circuit.log('reward', reward, 'multiplier', multiplier);

    const farmData = this.farmData.get();

    const newAccPerShare = farmData.accumulatedRewardsPerShare.add(
      safeUint64Div(
        reward.mul(this.fixedPointAccuracy),
        farmData.totalStakedBalance
      )
    );

    const newFarmData = new FarmData({
      accumulatedRewardsPerShare: newAccPerShare,
      totalStakedBalance: farmData.totalStakedBalance,
    });
    this.farmData.set(newFarmData);
    this.lastUpdate.set(blockHeight);
  }

  public calculateReward(
    farmData: FarmData,
    delegatorRecord: DelegatorRecord
  ): UInt64 {
    const accForUser = farmData.accumulatedRewardsPerShare.sub(
      delegatorRecord.accumulatedRewardPerShareStart
    );
    const delegatorRewardWithAccuracy = accForUser.mul(delegatorRecord.balance);

    const delegatorReward = delegatorRewardWithAccuracy.div(
      this.fixedPointAccuracy
    );
    return delegatorReward;
  }

  public applyAction(action: Action) {
    //this.updatePoolWithRewards();
    const { address, amount } = action.payload;

    // const afterSave = state.get();
    // Circuit.log('afterSave should be 32', afterSave);

    // to be called regardless of action type
    const farmData = this.farmData.get(); // 1x get on farmData in root
    const delegatorRecord = this.getDelegatorRecord(address); // 1x get on nested map => 1x get delegatorsMap in root

    const userReward = this.calculateReward(farmData, delegatorRecord);
    // todo: send userReward to user (!)
    Circuit.log('user reward', userReward);

    const newBalanceAfterDeposit = delegatorRecord.balance.add(amount);

    const newBalanceAfterWithdraw = Circuit.if(
      action.type.equals(Action.types.withdraw),
      UInt64.from(0),
      newBalanceAfterDeposit
    );

    // !! accumulatedRewardPerShare is the same as farm because of claim()
    const newDelegatorRecord = this.createDelegatorRecord(
      farmData.accumulatedRewardsPerShare,
      newBalanceAfterWithdraw
    );
    this.setDelegatorRecord(address, newDelegatorRecord); // 1x set on nested map => 1x set delegatorsMap in root

    // todo: send staked balance to user "newBalanceAfterDeposit" (!)

    // case deposit
    const totalStakedBalanceAfterDeposit = Circuit.if(
      action.type.equals(Action.types.deposit),
      farmData.totalStakedBalance.add(amount),
      farmData.totalStakedBalance
    );

    // case withdraw
    const newTotalStakedBalance = Circuit.if(
      action.type.equals(Action.types.withdraw),
      safeUint64Sub(totalStakedBalanceAfterDeposit, newBalanceAfterDeposit),
      totalStakedBalanceAfterDeposit
    );
    Circuit.log('newTotalStakedBalance', newTotalStakedBalance);

    const newFarmData = new FarmData({
      accumulatedRewardsPerShare: farmData.accumulatedRewardsPerShare,
      totalStakedBalance: newTotalStakedBalance,
    });
    this.farmData.set(newFarmData);
    this.emitEvent('totalStakedBalance', newFarmData.totalStakedBalance);
    this.emitEvent('userReward', userReward);
  }

  public reduce(rootHash: Field, action: Action): Field {
    this.updatePoolWithRewards();
    this.applyAction(action);
    return this.root.getRootHash();
  }

  @method
  @withOffchainState
  public rollup() {
    const actionsHash = this.actionsHash.get();

    this.actionsHash.assertEquals(actionsHash);

    const pendingActions = this.reducer.getActions({
      fromActionHash: actionsHash,
    });

    const currentRootHash = this.root.getRootHash();
    /**
     * Fail silently, until the following issue is resolved:
     * https://discord.com/channels/484437221055922177/1081186784622424154
     */
    // eslint-disable-next-line snarkyjs/no-if-in-circuit
    if (!this.virtualStorage?.data) {
      console.log('Skipping execution, because no virtual storage was found');
      return;
    }

    const { actionsHash: newActionsHash, state: newRootHash } =
      this.withRollingState(() =>
        this.reducer.reduce(
          pendingActions,
          Field,
          this.reduce.bind(this),
          {
            state: currentRootHash,
            actionsHash,
          },
          { maxTransactionsWithActions: 1 }
        )
      );

    Circuit.log('rollup done');
    this.actionsHash.set(newActionsHash);
    this.root.setRootHash(newRootHash);
  }
}
