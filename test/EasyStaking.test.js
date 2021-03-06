const { BN, expectRevert, expectEvent, constants, time, balance, send } = require('@openzeppelin/test-helpers');
const chai = require('chai');
const { ethers } = require('ethers');
const _deploy_cyt = require('../migrations/4_deploy_cyt');

const expect = chai.expect;

const EasyStaking = artifacts.require('EasyStaking');
const ReceiverMock = artifacts.require('ReceiverMock');
const Token = artifacts.require('CyberpopToken');
const MockToken = artifacts.require('ERC20Mock');
const ExtendedMathMock = artifacts.require('ExtendedMathMock');

chai.use(require('chai-bn')(BN));

contract('EasyStaking', accounts => {
  const ether = (v) => new BN(parseFloat(v) * 1e6)
  const [owner, user1, user2, liquidityProvidersRewardAddress, user4] = accounts;
  const YEAR = new BN(31536000); // in seconds
  const MAX_EMISSION_RATE = ether('0.15'); // 15%
  const PARAM_UPDATE_DELAY = new BN(604800); // 7 days in seconds
  const fee = ether('0.03'); // 3%
  const withdrawalLockDuration = new BN(3600); // in seconds
  const withdrawalUnlockDuration = new BN(3600); // in seconds
  const sigmoidParamA = ether('0.075'); // 7.5%
  const sigmoidParamB = new BN(0);
  const sigmoidParamC = new BN(10);
  const oneEther = ether('1');
  const totalSupplyFactor = oneEther;
  const ACL_ERROR = `AccessControl: account ${user1.toLowerCase()} is missing role 0x0000000000000000000000000000000000000000000000000000000000000000`

  let easyStaking;
  let stakeToken;

  function initialize(...params) {
    if (params.length === 0) {
      params = [
        owner,
        stakeToken.address,
        liquidityProvidersRewardAddress,
        fee.toString(),
        withdrawalLockDuration.toString(),
        withdrawalUnlockDuration.toString(),
        totalSupplyFactor.toString(),
        sigmoidParamA.toString(),
        sigmoidParamB.toString(),
        sigmoidParamC.toString(),
      ];
    }
    return EasyStaking.new(...params, { from: owner });
  }

  function squareRoot(x) {
    const one = new BN(1);
    const two = new BN(2);
    let z = x.add(one).div(two)
    let y = x
    while (z.lt(y)) {
      y = z
      z = x.div(z).add(z).div(two)
    }
    return y
  }

  function calculateSupplyBasedEmissionRate(totalSupply, totalStaked, factor = totalSupplyFactor) {
    return MAX_EMISSION_RATE.div(new BN(2)).mul(totalStaked).div(totalSupply.mul(factor).div(oneEther));
  }

  function calculateUserEmissionRate(timePassed, totalSupply, totalStaked) {
    let uk = timePassed.sub(sigmoidParamB)
    let userEmissionRate = sigmoidParamA.mul(uk).div(squareRoot(uk.sqr().add(sigmoidParamC)));
    if (userEmissionRate.lt(new BN(0))) {
      userEmissionRate = new BN(0);
    }
    const emissionRateBasedOnTotalStakedAmount = calculateSupplyBasedEmissionRate(totalSupply, totalStaked);
    return userEmissionRate.add(emissionRateBasedOnTotalStakedAmount);
  }

  function calculateAccruedEmission(deposit, timePassed, emissionRate) {
    return deposit.mul(emissionRate).mul(timePassed).div(oneEther).div(YEAR);
  }

  function calculateUserAccruedEmission(deposit, timePassed, totalSupply, totalStaked) {
    const userEmissionRate = calculateUserEmissionRate(timePassed, totalSupply, totalStaked);
    return calculateAccruedEmission(deposit, timePassed, userEmissionRate);
  }

  function calculateTotalAccruedEmission(deposit, timePassed, totalSupply, totalStaked) {
    const userAccruedEmission = calculateUserAccruedEmission(deposit, timePassed, totalSupply, totalStaked);
    const totalAccruedEmission = calculateAccruedEmission(deposit, timePassed, MAX_EMISSION_RATE);
    return { userShare: userAccruedEmission, liquidityProvidersReward: totalAccruedEmission.sub(userAccruedEmission) };
  }

  async function getBlockTimestamp(receipt) {
    return new BN((await web3.eth.getBlock(receipt.receipt.blockNumber)).timestamp);
  }

  beforeEach(async () => {
    stakeToken = await Token.deployed();
    easyStaking = await initialize();
    liquidityProvidersRewardContract = await ReceiverMock.new();
  });

  describe('initialize', () => {
    it('should be set up correctly', async () => {
      expect(await easyStaking.token()).to.equal(stakeToken.address);
      const params = await easyStaking.getSigmoidParameters();
      expect(params.a).to.be.bignumber.equal(sigmoidParamA);
      expect(params.b).to.be.bignumber.equal(sigmoidParamB);
      expect(params.c).to.be.bignumber.equal(sigmoidParamC);
    });
    it('fails if any of parameters is incorrect', async () => {
      await expectRevert(
        initialize(
          constants.ZERO_ADDRESS,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'zero address'
      );
      await expectRevert(
        initialize(
          owner,
          constants.ZERO_ADDRESS,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'not a contract address'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          ether('1.01').toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'should be less than or equal to 1'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          ether('1.01').toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'should be less than or equal to 1'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          2592001,
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        `shouldn't be greater than 30 days`
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          0,
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        `shouldn't be less than 1 hour`
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          liquidityProvidersRewardAddress,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          ether('0.076').toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'should be less than or equal to a half of the maximum emission rate'
      );
      await expectRevert(
        initialize(
          owner,
          stakeToken.address,
          constants.ZERO_ADDRESS,
          fee.toString(),
          withdrawalLockDuration.toString(),
          withdrawalUnlockDuration.toString(),
          totalSupplyFactor.toString(),
          sigmoidParamA.toString(),
          sigmoidParamB.toString(),
          sigmoidParamC.toString(),
        ),
        'zero address'
      );
    });
  });
  function testDeposit(directly) {
    beforeEach(async () => {
      await stakeToken.transfer(user1, ether('1000'), { from: owner });
      await stakeToken.approve(easyStaking.address, ether('10000'), { from: user1 });
    });
    it('should deposit', async () => {
      const value = ether('100');
      let receipt;
      if (directly) {
        receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
        expectEvent(receipt, 'Deposited', {
          sender: user1,
          amount: value,
          id: new BN(1),
          balance: value,
          accruedEmission: new BN(0),
          prevDepositDuration: new BN(0),
        });
      } else {
        receipt = await stakeToken.transferAndCall(easyStaking.address, value, { from: user1 });
      }
      const timestamp = await getBlockTimestamp(receipt);
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value);
      expect(await easyStaking.depositDates(user1, 1)).to.be.bignumber.equal(timestamp);
    });
    it('should accrue emission', async () => {
      const value = ether('100');
      let receipt;
      if (directly) {
        receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      } else {
        receipt = await stakeToken.transferAndCall(easyStaking.address, value, { from: user1 });
      }
      const timestampBefore = await getBlockTimestamp(receipt);
      await time.increase(YEAR.div(new BN(8)));
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.methods['deposit(uint256,uint256)'](1, value, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      if (directly) {
        expectEvent(receipt, 'Deposited', {
          sender: user1,
          amount: value,
          id: new BN(1),
          balance: value.add(value).add(userAccruedEmission),
          accruedEmission: userAccruedEmission,
          prevDepositDuration: new BN(timePassed),
        });
      }
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value.add(value).add(userAccruedEmission));
      expect(await easyStaking.depositDates(user1, 1)).to.be.bignumber.equal(timestampAfter);
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(value.add(value).add(userAccruedEmission));
    });
    it('should deposit using an old id', async () => {
      let reserve = ether('100')
      await stakeToken.increaseAllowance(easyStaking.address, reserve)
      await easyStaking.depositReserve(reserve)
      await easyStaking.setFee(0, { from: owner });
      const value = ether('100');
      if (directly) {
        await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
        await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      } else {
        await stakeToken.transferAndCall(easyStaking.address, value, { from: user1 });
        await stakeToken.transferAndCall(easyStaking.address, value, { from: user1 });
      }
      await time.increase(YEAR);
      await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      await easyStaking.makeForcedWithdrawal(2, 0, { from: user1 });
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.balances(user1, 2)).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.depositDates(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.depositDates(user1, 2)).to.be.bignumber.equal(new BN(0));

      let receipt = await easyStaking.methods['deposit(uint256,uint256)'](1, value, { from: user1 });
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value);
      const timestampBefore = await getBlockTimestamp(receipt);
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      const balanceBefore = await stakeToken.balanceOf(user1);
      await time.increase(YEAR);
      receipt = await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      const balanceAfter = await stakeToken.balanceOf(user1);
      expectEvent(receipt, 'Withdrawn', {
        sender: user1,
        amount: value.add(userAccruedEmission),
        id: new BN(1),
        balance: new BN(0),
        accruedEmission: userAccruedEmission,
        lastDepositDuration: timePassed,
      });
      expect(balanceAfter).to.be.bignumber.equal(balanceBefore.add(value.add(userAccruedEmission)));
    });
    it('fails if deposit value is zero', async () => {
      if (directly) {
        await expectRevert(
          easyStaking.methods['deposit(uint256)'](0, { from: user1 }),
          'deposit amount should be more than 0'
        );
      } else {
        await expectRevert(
          stakeToken.transferAndCall(easyStaking.address, 0, { from: user1 }),
          `You can't transfer to staking contract` // if onTokenTransfer() fails
        );
      }
    });
    it('fails if emission is stopped', async () => {
      await easyStaking.setSigmoidParameters(0, sigmoidParamB, sigmoidParamC);
      await easyStaking.setTotalSupplyFactor(0);
      await time.increase(PARAM_UPDATE_DELAY.add(new BN(1)));
      if (directly) {
        await expectRevert(
          easyStaking.methods['deposit(uint256)'](ether('1'), { from: user1 }),
          "emission stopped"
        );
      } else {
        await expectRevert(
          stakeToken.transferAndCall(easyStaking.address, ether('1'), { from: user1 }),
          `You can't transfer to staking contract` // if onTokenTransfer() fails
        );
      }
    });
  }
  describe('deposit', () => {
    testDeposit(true);
    it('fails if wrong deposit id', async () => {
      await expectRevert(
        easyStaking.methods['deposit(uint256,uint256)'](1, ether('100'), { from: user1 }),
        'wrong deposit id'
      );
    });
  });
  describe('onTokenTransfer', () => {
    testDeposit(false);
    it('fails if not a token address', async () => {
      await expectRevert(
        easyStaking.onTokenTransfer(user1, ether('1'), '0x', { from: owner }),
        'only token contract is allowed'
      );
    });
  });
  describe('makeForcedWithdrawal', () => {
    const value = ether('1000000');

    beforeEach(async () => {
      let b = await stakeToken.balanceOf(user1);
      await stakeToken.transfer(owner, b, { from: user1 }); // clean balance
      await stakeToken.transfer(user1, value, { from: owner });
      await stakeToken.increaseAllowance(easyStaking.address, value, { from: user1 });
    });
    it('should withdraw', async () => {
      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      let timestampBefore = await getBlockTimestamp(receipt);
      let totalStaked = await easyStaking.totalStaked();
      expect(totalStaked).to.be.bignumber.equal(value);
      let totalSupply = await stakeToken.totalSupply();
      await time.increase(3600 * 24); // make sure the timestamp of two consequent blocks is different
      receipt = await easyStaking.makeForcedWithdrawal(1, oneEther, { from: user1 });
      let timestampAfter = await getBlockTimestamp(receipt);
      expect(timestampAfter).to.be.bignumber.gt(timestampBefore);
      let timePassed = timestampAfter.sub(timestampBefore);
      expect(timePassed).to.be.bignumber.gte(new BN(1));
      const userAccruedEmission1 = calculateUserAccruedEmission(oneEther, timePassed, totalSupply, totalStaked);
      expect(userAccruedEmission1).to.be.bignumber.gt(new BN(0));
      const feeValue1 = oneEther.add(userAccruedEmission1).mul(fee).div(oneEther);
      expect(feeValue1).to.be.bignumber.gt(new BN(0));
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value.sub(oneEther));
      expect(await easyStaking.depositDates(user1, 1)).to.be.bignumber.equal(timestampBefore);
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(value.sub(oneEther));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(oneEther.add(userAccruedEmission1).sub(feeValue1));
      expectEvent(receipt, 'Withdrawn', {
        sender: user1,
        amount: oneEther.add(userAccruedEmission1).sub(feeValue1),
        id: new BN(1),
        balance: value.sub(oneEther),
        accruedEmission: userAccruedEmission1,
        lastDepositDuration: timePassed,
        fee: feeValue1,
      });
      totalSupply = await stakeToken.totalSupply();
      totalStaked = await easyStaking.totalStaked();
      await time.increase(1); // make sure the timestamp of two consequent blocks is different
      let contractBalance = await stakeToken.balanceOf(easyStaking.address)
      let newBalance = contractBalance.add(ether('500'))
      await stakeToken.increaseAllowance(easyStaking.address, ether('500'), { from: owner })
      await easyStaking.depositReserve(ether('500'), { from: owner })
      contractBalance = await stakeToken.balanceOf(easyStaking.address)
      expect(contractBalance).to.be.bignumber.equal(newBalance)

      const depositDate = await easyStaking.depositDates(user1, 1);
      const accruedEmissionResp = await easyStaking.getAccruedEmission(depositDate, value.sub(oneEther));
      let totalNeeded = accruedEmissionResp.total.add(value.sub(oneEther))
      expect(newBalance).to.be.bignumber.gt(totalNeeded);

      receipt = await easyStaking.makeForcedWithdrawal(1, value.sub(oneEther), { from: user1 });
      timestampAfter = await getBlockTimestamp(receipt);
      timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission2 = calculateUserAccruedEmission(value.sub(oneEther), timePassed, totalSupply, totalStaked);
      expect(userAccruedEmission2).to.be.bignumber.gt(new BN(0));
      const feeValue2 = value.sub(oneEther).add(userAccruedEmission2).mul(fee).div(oneEther);
      expect(feeValue2).to.be.bignumber.gt(new BN(0));
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(new BN(0));
      const expectedBalance = value.add(userAccruedEmission1).add(userAccruedEmission2).sub(feeValue1).sub(feeValue2);
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(expectedBalance);
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.depositDates(user1, 1)).to.be.bignumber.equal(new BN(0));
      expectEvent(receipt, 'Withdrawn', {
        sender: user1,
        amount: value.sub(oneEther).add(userAccruedEmission2).sub(feeValue2),
        id: new BN(1),
        balance: new BN(0),
        accruedEmission: userAccruedEmission2,
        lastDepositDuration: timestampAfter.sub(timestampBefore),
        fee: feeValue2,
      });
    });
    it('should withdraw with accrued emission', async () => {
      stakeToken.increaseAllowance(easyStaking.address, ether('18751'))
      easyStaking.depositReserve(ether('18751'))
      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      const timestampBefore = await getBlockTimestamp(receipt);
      await time.increase(YEAR.div(new BN(8)));
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();

      receipt = await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const { userShare, liquidityProvidersReward } = calculateTotalAccruedEmission(value, timePassed, totalSupply, totalStaked);
      const feeValue = value.add(userShare).mul(fee).div(oneEther);
      expect(userShare).to.be.bignumber.gt(new BN(0));
      expect(feeValue).to.be.bignumber.gt(new BN(0));
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(value.add(userShare).sub(feeValue));
      // FIXME
      // expect(await stakeToken.balanceOf(liquidityProvidersRewardAddress)).to.be.bignumber.equal(liquidityProvidersReward.add(feeValue));
    });
    it('should withdraw part and accrue emission', async () => {
      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      let remainingBalance = await stakeToken.balanceOf(user1);
      const timestampBefore = await getBlockTimestamp(receipt);
      await time.increase(YEAR.div(new BN(8)));
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.makeForcedWithdrawal(1, oneEther, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(oneEther, timePassed, totalSupply, totalStaked);
      const feeValue = oneEther.add(userAccruedEmission).mul(fee).div(oneEther);
      expect(userAccruedEmission).to.be.bignumber.gt(new BN(0));
      expect(feeValue).to.be.bignumber.gt(new BN(0));
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value.sub(oneEther));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(remainingBalance.add(oneEther.add(userAccruedEmission).sub(feeValue)));
    });
    it('should accrue emission for different users from 1 address', async () => {
      const exchange = user1;
      const values = [ether('100'), ether('250'), ether('600')];
      const MONTH = 2592000; // in seconds
      for (let i = 0; i < 3; i++) {
        await easyStaking.methods['deposit(uint256)'](values[i], { from: exchange });
        expect(await easyStaking.balances(exchange, i + 1)).to.be.bignumber.equal(values[i]);
      }
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(values.reduce((acc, cur) => acc.add(cur), new BN(0)));
      let exchangeBalance = await stakeToken.balanceOf(exchange);
      await time.increase(MONTH * 4);

      stakeToken.increaseAllowance(easyStaking.address, ether('200'))
      easyStaking.depositReserve(ether('200'))

      for (let i = 0; i < 3; i++) {
        const timestampBefore = await easyStaking.depositDates(exchange, i + 1);
        const totalSupply = await stakeToken.totalSupply();
        const totalStaked = await easyStaking.totalStaked();
        const receipt = await easyStaking.makeForcedWithdrawal(i + 1, 0, { from: user1 });
        const timestampAfter = await getBlockTimestamp(receipt);
        const timePassed = timestampAfter.sub(timestampBefore);
        const userAccruedEmission = calculateUserAccruedEmission(values[i], timePassed, totalSupply, totalStaked);
        const feeValue = values[i].add(userAccruedEmission).mul(fee).div(oneEther);
        const expectedExchangeBalance = exchangeBalance.add(values[i]).add(userAccruedEmission).sub(feeValue);
        expect(userAccruedEmission).to.be.bignumber.gt(new BN(0));
        expect(feeValue).to.be.bignumber.gt(new BN(0));
        expect(await easyStaking.balances(exchange, i + 1)).to.be.bignumber.equal(new BN(0));
        expect(await stakeToken.balanceOf(exchange)).to.be.bignumber.equal(expectedExchangeBalance);
        exchangeBalance = expectedExchangeBalance;
        await time.increase(MONTH * 4);
      }
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(new BN(0));
    });
    it('should pause minting tokens', async () => {
      stakeToken.increaseAllowance(easyStaking.address, ether('100'))
      easyStaking.depositReserve(ether('100'))

      await easyStaking.setFee(0, { from: owner });
      await easyStaking.methods['deposit(uint256)'](ether('100'), { from: user1 });
      await easyStaking.methods['deposit(uint256)'](ether('100'), { from: user1 });
      await time.increase(YEAR);
      let balanceBefore = await stakeToken.balanceOf(user1);
      await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      let balanceAfter = await stakeToken.balanceOf(user1);
      expect(balanceAfter).to.be.bignumber.gt(balanceBefore.add(ether('100')));
      // let minter = await stakeToken.MINTER_ROLE()
      // expect(await stakeToken.hasRole(minter, easyStaking.address)).to.be.equal(true);
      // await stakeToken.removeMinter(easyStaking.address);
      // expect(await stakeToken.hasRole(minter, easyStaking.address)).to.be.equal(false);
      await easyStaking.setSigmoidParameters(0, sigmoidParamB, sigmoidParamC, { from: owner });
      await easyStaking.setTotalSupplyFactor(0, { from: owner });
      await time.increase(PARAM_UPDATE_DELAY.add(new BN(1)));
      balanceBefore = balanceAfter;
      await easyStaking.makeForcedWithdrawal(2, 0, { from: user1 });
      balanceAfter = await stakeToken.balanceOf(user1);
      // FIXME: not sure how it should work when there is not enough token to pay reward
      // expect(balanceAfter).to.be.bignumber.equal(balanceBefore.add(ether('100'))); // 0 emission
    });
    it('fails if trying to withdraw more than deposited', async () => {
      stakeToken.increaseAllowance(easyStaking.address, ether('100'))
      easyStaking.depositReserve(ether('100'))

      await easyStaking.methods['deposit(uint256)'](ether('10'), { from: user1 });
      await time.increase(YEAR);
      await expectRevert(
        easyStaking.makeForcedWithdrawal(1, ether('10.000001'), { from: user1 }),
        'insufficient funds'
      );
      await easyStaking.makeForcedWithdrawal(1, ether('10'), { from: user1 });
    });
    it('fails if wrong deposit id', async () => {
      await easyStaking.methods['deposit(uint256)'](ether('10'), { from: user1 });
      await expectRevert(
        easyStaking.makeForcedWithdrawal(2, ether('10'), { from: user1 }),
        'wrong deposit id'
      );
      await easyStaking.makeForcedWithdrawal(1, ether('10'), { from: user1 });
    });
    it('fails if zero balance', async () => {
      await easyStaking.methods['deposit(uint256)'](ether('10'), { from: user1 });
      await easyStaking.makeForcedWithdrawal(1, ether('10'), { from: user1 });
      await expectRevert(
        easyStaking.makeForcedWithdrawal(1, ether('10'), { from: user1 }),
        'insufficient funds'
      );
    });
    it('should withdraw entire deposit by several parts', async () => {
      stakeToken.increaseAllowance(easyStaking.address, ether('300000'))
      easyStaking.depositReserve(ether('300000'))

      await easyStaking.setFee(0);
      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(new BN(0));
      const timestampBefore = await getBlockTimestamp(receipt);
      const parts = [
        ether('100000'), ether('250000'), ether('333000'), ether('55000'),
        ether('990'), ether('200267'), ether('60743'),
      ];
      const durations = [
        YEAR.div(new BN(12)), YEAR.div(new BN(2)), YEAR.div(new BN(6)),
        YEAR, new BN(86400), YEAR.mul(new BN(2)), new BN(604800),
      ];
      let withdrawnValue = new BN(0);
      let totalAccruedEmission = new BN(0);
      for (let i = 0; i < parts.length; i++) {
        await time.increase(durations[i]);
        const totalSupply = await stakeToken.totalSupply();
        const totalStaked = await easyStaking.totalStaked();
        receipt = await easyStaking.makeForcedWithdrawal(1, parts[i], { from: user1 });
        const timestampAfter = await getBlockTimestamp(receipt);
        const timePassed = timestampAfter.sub(timestampBefore);
        const userAccruedEmission = calculateUserAccruedEmission(parts[i], timePassed, totalSupply, totalStaked);
        withdrawnValue = withdrawnValue.add(parts[i]);
        totalAccruedEmission = totalAccruedEmission.add(userAccruedEmission);
        expectEvent(receipt, 'Withdrawn', {
          sender: user1,
          amount: parts[i].add(userAccruedEmission),
          id: new BN(1),
          balance: value.sub(withdrawnValue),
          accruedEmission: userAccruedEmission,
          lastDepositDuration: timePassed,
          fee: new BN(0),
        });
      }
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(value.add(totalAccruedEmission));
    });
    it('should withdraw the same amount', async () => {
      await easyStaking.setFee(0);
      stakeToken.increaseAllowance(easyStaking.address, ether('300000'))
      easyStaking.depositReserve(ether('300000'))

      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      let timestampBefore = await getBlockTimestamp(receipt);
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(value);
      await time.increase(YEAR);
      let totalSupply = await stakeToken.totalSupply();
      let totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      let timestampAfter = await getBlockTimestamp(receipt);
      let timePassed = timestampAfter.sub(timestampBefore);
      let userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(value.add(userAccruedEmission));

      await stakeToken.transfer(user2, value, { from: owner });
      await stakeToken.approve(easyStaking.address, value, { from: user2 });

      stakeToken.increaseAllowance(easyStaking.address, ether('300000'))
      easyStaking.depositReserve(ether('300000'))

      receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user2 });
      timestampBefore = await getBlockTimestamp(receipt);
      expect(await easyStaking.balances(user2, 1)).to.be.bignumber.equal(value);
      await time.increase(YEAR);
      totalSupply = await stakeToken.totalSupply();
      totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.makeForcedWithdrawal(1, value, { from: user2 });
      timestampAfter = await getBlockTimestamp(receipt);
      timePassed = timestampAfter.sub(timestampBefore);
      userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      expect(await easyStaking.balances(user2, 1)).to.be.bignumber.equal(new BN(0));
      expect(await stakeToken.balanceOf(user2)).to.be.bignumber.equal(value.add(userAccruedEmission));
    });
  });
  describe('requestWithdrawal', () => {
    it('should request', async () => {
      const value = ether('1000');
      await stakeToken.transfer(user1, value, { from: owner });
      await stakeToken.transferAndCall(easyStaking.address, value, { from: user1 });
      const receipt = await easyStaking.requestWithdrawal(1, { from: user1 });
      const timestamp = await getBlockTimestamp(receipt);
      expect(await easyStaking.withdrawalRequestsDates(user1, 1)).to.be.bignumber.equal(timestamp);
      expectEvent(receipt, 'WithdrawalRequested', {
        sender: user1,
        id: new BN(1),
      });
    });
    it('fails if wrong deposit id', async () => {
      await expectRevert(easyStaking.requestWithdrawal(1, { from: user1 }), 'wrong deposit id');
    });
  });
  describe('makeRequestedWithdrawal', () => {
    const value = ether('1000');
    beforeEach(async () => {
      await stakeToken.increaseAllowance(easyStaking.address, ether('100'));
      await easyStaking.depositReserve(ether('100'));

      await stakeToken.transfer(user1, value, { from: owner });
      await stakeToken.approve(easyStaking.address, ether('10000'), { from: user1 });
    });
    it('should withdraw', async () => {
      let receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      let remainingBalance = await stakeToken.balanceOf(user1)
      const timestampBefore = await getBlockTimestamp(receipt);
      await easyStaking.requestWithdrawal(1, { from: user1 });
      await time.increase(withdrawalLockDuration);
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      receipt = await easyStaking.makeRequestedWithdrawal(1, 0, { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      expect(await easyStaking.withdrawalRequestsDates(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(new BN(0));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(remainingBalance.add(value.add(userAccruedEmission)));
      expectEvent(receipt, 'Withdrawn', {
        sender: user1,
        amount: value.add(userAccruedEmission),
        id: new BN(1),
        balance: new BN(0),
        accruedEmission: userAccruedEmission,
        lastDepositDuration: timePassed,
      });
    });
    it('should fail if not requested', async () => {
      await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      await expectRevert(easyStaking.makeRequestedWithdrawal(1, 0, { from: user1 }), `withdrawal wasn't requested`);
    });
    it('should fail if too early', async () => {
      await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      await easyStaking.requestWithdrawal(1, { from: user1 });
      await time.increase(withdrawalLockDuration.sub(new BN(5)));
      await expectRevert(easyStaking.makeRequestedWithdrawal(1, 0, { from: user1 }), 'too early');
    });
    it('should fail if too late', async () => {
      await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      await easyStaking.requestWithdrawal(1, { from: user1 });
      await time.increase(withdrawalLockDuration.add(withdrawalUnlockDuration).add(new BN(1)));
      await expectRevert(easyStaking.makeRequestedWithdrawal(1, 0, { from: user1 }), 'too late');
    });
  });
  describe('totalStaked', () => {
    it('should be calculated correctly', async () => {
      stakeToken.increaseAllowance(easyStaking.address, ether('300000'))
      easyStaking.depositReserve(ether('300000'))

      let expectedTotalStaked = new BN(0);
      const value = ether('1000');
      await stakeToken.transfer(owner, value, { from: owner });
      await stakeToken.transfer(user1, value, { from: owner });
      await stakeToken.transfer(user2, value, { from: owner });
      await stakeToken.transferAndCall(easyStaking.address, ether('10'), { from: owner });
      expectedTotalStaked = expectedTotalStaked.add(ether('10'));
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(expectedTotalStaked);
      await time.increase(1);
      let receipt = await stakeToken.transferAndCall(easyStaking.address, ether('500'), { from: user1 });
      const timestampBefore = await getBlockTimestamp(receipt);
      expectedTotalStaked = expectedTotalStaked.add(ether('500'));
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(expectedTotalStaked);
      await time.increase(1);
      await easyStaking.makeForcedWithdrawal(1, ether('250'), { from: user1 });
      expectedTotalStaked = expectedTotalStaked.sub(ether('250'));
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(expectedTotalStaked);
      await time.increase(1);
      await stakeToken.transferAndCall(easyStaking.address, ether('1000'), { from: user2 });
      expectedTotalStaked = expectedTotalStaked.add(ether('1000'));
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(expectedTotalStaked);
      await time.increase(1);
      await stakeToken.transferAndCall(easyStaking.address, ether('40'), { from: user1 });
      expectedTotalStaked = expectedTotalStaked.add(ether('40'));
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(expectedTotalStaked);
      await time.increase(1);
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      await stakeToken.approve(easyStaking.address, ether('333'), { from: user1 });
      receipt = await easyStaking.methods['deposit(uint256,uint256)'](1, ether('333'), { from: user1 });
      const timestampAfter = await getBlockTimestamp(receipt);
      const timePassed = timestampAfter.sub(timestampBefore);
      const userAccruedEmission = calculateUserAccruedEmission(ether('250'), timePassed, totalSupply, totalStaked);
      expectedTotalStaked = expectedTotalStaked.add(ether('333')).add(userAccruedEmission);
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(expectedTotalStaked);
      await time.increase(1);
      await easyStaking.makeForcedWithdrawal(1, 0, { from: owner });
      expectedTotalStaked = expectedTotalStaked.sub(ether('10'));
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(expectedTotalStaked);
      await time.increase(1);
      await easyStaking.makeForcedWithdrawal(1, 0, { from: user2 });
      expectedTotalStaked = expectedTotalStaked.sub(ether('1000'));
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(expectedTotalStaked);
      await time.increase(1);
      await easyStaking.makeForcedWithdrawal(1, 0, { from: user1 });
      expectedTotalStaked = expectedTotalStaked.sub(ether('583')).sub(userAccruedEmission);
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(expectedTotalStaked);
      await time.increase(1);
      await easyStaking.makeForcedWithdrawal(2, 0, { from: user1 });
      expectedTotalStaked = expectedTotalStaked.sub(ether('40'));
      expect(await easyStaking.totalStaked()).to.be.bignumber.equal(new BN(0));
      expect(expectedTotalStaked).to.be.bignumber.equal(new BN(0));
    });
  });
  describe('setFee', () => {
    it('should set', async () => {
      const newFee = ether('0.1');
      expect(await easyStaking.fee()).to.be.bignumber.equal(fee);
      expect(newFee).to.be.bignumber.not.equal(fee);
      const receipt = await easyStaking.setFee(newFee, { from: owner });
      expectEvent(receipt, 'FeeSet', { value: newFee, sender: owner });
      await time.increase(PARAM_UPDATE_DELAY.sub(new BN(1)));
      expect(await easyStaking.fee()).to.be.bignumber.equal(fee);
      await time.increase(2);
      expect(await easyStaking.fee()).to.be.bignumber.equal(newFee);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setFee(ether('0.1'), { from: user1 }),
        ACL_ERROR,
      );
    });
    it('fails if greater than 1 ether', async () => {
      await expectRevert(easyStaking.setFee(ether('1.01'), { from: owner }), 'should be less than or equal to 1 ether');
    });
  });
  describe('setWithdrawalLockDuration', () => {
    it('should set', async () => {
      const newWithdrawalLockDuration = new BN(1000);
      expect(await easyStaking.withdrawalLockDuration()).to.be.bignumber.equal(withdrawalLockDuration);
      expect(newWithdrawalLockDuration).to.be.bignumber.not.equal(withdrawalLockDuration);
      const receipt = await easyStaking.setWithdrawalLockDuration(newWithdrawalLockDuration, { from: owner });
      expectEvent(receipt, 'WithdrawalLockDurationSet', { value: newWithdrawalLockDuration, sender: owner });
      await time.increase(PARAM_UPDATE_DELAY.sub(new BN(1)));
      expect(await easyStaking.withdrawalLockDuration()).to.be.bignumber.equal(withdrawalLockDuration);
      await time.increase(2);
      expect(await easyStaking.withdrawalLockDuration()).to.be.bignumber.equal(newWithdrawalLockDuration);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setWithdrawalLockDuration(new BN(1000), { from: user1 }),
        ACL_ERROR,
      );
    });
    it('fails if greater than 30 days', async () => {
      await expectRevert(easyStaking.setWithdrawalLockDuration(2592001, { from: owner }), `shouldn't be greater than 30 days`);
    });
  });
  describe('setWithdrawalUnlockDuration', () => {
    it('should set', async () => {
      const newWithdrawalUnlockDuration = new BN(10000);
      expect(await easyStaking.withdrawalUnlockDuration()).to.be.bignumber.equal(withdrawalUnlockDuration);
      expect(newWithdrawalUnlockDuration).to.be.bignumber.not.equal(withdrawalUnlockDuration);
      const receipt = await easyStaking.setWithdrawalUnlockDuration(newWithdrawalUnlockDuration, { from: owner });
      expectEvent(receipt, 'WithdrawalUnlockDurationSet', { value: newWithdrawalUnlockDuration, sender: owner });
      await time.increase(PARAM_UPDATE_DELAY.sub(new BN(1)));
      expect(await easyStaking.withdrawalUnlockDuration()).to.be.bignumber.equal(withdrawalUnlockDuration);
      await time.increase(2);
      expect(await easyStaking.withdrawalUnlockDuration()).to.be.bignumber.equal(newWithdrawalUnlockDuration);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setWithdrawalUnlockDuration(new BN(10000), { from: user1 }),
        ACL_ERROR,
      );
    });
    it('fails if less than 1 hour', async () => {
      await expectRevert(easyStaking.setWithdrawalUnlockDuration(3599, { from: owner }), `shouldn't be less than 1 hour`);
    });
  });
  describe('setTotalSupplyFactor', () => {
    it('should set', async () => {
      const newTotalSupplyFactor = ether('0.9');
      expect(await easyStaking.totalSupplyFactor()).to.be.bignumber.equal(totalSupplyFactor);
      expect(newTotalSupplyFactor).to.be.bignumber.not.equal(totalSupplyFactor);
      const receipt = await easyStaking.setTotalSupplyFactor(newTotalSupplyFactor, { from: owner });
      expectEvent(receipt, 'TotalSupplyFactorSet', { value: newTotalSupplyFactor, sender: owner });
      await time.increase(PARAM_UPDATE_DELAY.sub(new BN(1)));
      expect(await easyStaking.totalSupplyFactor()).to.be.bignumber.equal(totalSupplyFactor);
      await time.increase(2);
      expect(await easyStaking.totalSupplyFactor()).to.be.bignumber.equal(newTotalSupplyFactor);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setTotalSupplyFactor(ether('0.9'), { from: user1 }),
        ACL_ERROR,
      );
    });
    it('fails if greater than 1 ether', async () => {
      await expectRevert(
        easyStaking.setTotalSupplyFactor(ether('1.01'), { from: owner }),
        'should be less than or equal to 1 ether'
      );
    });
  });
  describe('setSigmoidParameters', () => {
    it('should set', async () => {
      const newSigmoidParams = { a: ether('0.065'), b: new BN(10000), c: new BN(999999) };
      let sigmoidParams = await easyStaking.getSigmoidParameters();
      expect(sigmoidParams.a).to.be.bignumber.equal(sigmoidParamA);
      expect(sigmoidParams.b).to.be.bignumber.equal(sigmoidParamB);
      expect(sigmoidParams.c).to.be.bignumber.equal(sigmoidParamC);
      const receipt = await easyStaking.setSigmoidParameters(newSigmoidParams.a, newSigmoidParams.b, newSigmoidParams.c, { from: owner });
      expectEvent(receipt, 'SigmoidParametersSet', { a: newSigmoidParams.a, b: newSigmoidParams.b, c: newSigmoidParams.c, sender: owner });
      await time.increase(PARAM_UPDATE_DELAY.sub(new BN(1)));
      sigmoidParams = await easyStaking.getSigmoidParameters();
      expect(sigmoidParams.a).to.be.bignumber.equal(sigmoidParamA);
      expect(sigmoidParams.b).to.be.bignumber.equal(sigmoidParamB);
      expect(sigmoidParams.c).to.be.bignumber.equal(sigmoidParamC);
      await time.increase(2);
      sigmoidParams = await easyStaking.getSigmoidParameters();
      expect(sigmoidParams.a).to.be.bignumber.equal(newSigmoidParams.a);
      expect(sigmoidParams.b).to.be.bignumber.equal(newSigmoidParams.b);
      expect(sigmoidParams.c).to.be.bignumber.equal(newSigmoidParams.c);
    });
    it('fails if not an owner', async () => {
      const newSigmoidParams = { a: ether('0.065'), b: new BN(10000), c: new BN(999999) };
      await expectRevert(
        easyStaking.setSigmoidParameters(newSigmoidParams.a, newSigmoidParams.b, newSigmoidParams.c, { from: user1 }),
        ACL_ERROR,
      );
    });
    it('fails if wrong values', async () => {
      await expectRevert(
        easyStaking.setSigmoidParameters(ether('0.076'), sigmoidParamB, sigmoidParamC),
        'should be less than or equal to a half of the maximum emission rate'
      );
      await expectRevert(easyStaking.setSigmoidParameters(sigmoidParamA, sigmoidParamB, 0), 'should be greater than 0');
    });
  });
  describe('setLiquidityProvidersRewardAddress', () => {
    it('should set', async () => {
      const newLiquidityProvidersRewardAddress = user1;
      expect(await easyStaking.liquidityProvidersRewardAddress()).to.be.bignumber.equal(liquidityProvidersRewardAddress);
      expect(newLiquidityProvidersRewardAddress).to.be.bignumber.not.equal(liquidityProvidersRewardAddress);
      const receipt = await easyStaking.setLiquidityProvidersRewardAddress(newLiquidityProvidersRewardAddress, { from: owner });
      expectEvent(receipt, 'LiquidityProvidersRewardAddressSet', { value: newLiquidityProvidersRewardAddress, sender: owner });
      await time.increase(PARAM_UPDATE_DELAY.sub(new BN(1)));
      expect(await easyStaking.liquidityProvidersRewardAddress()).to.be.bignumber.equal(liquidityProvidersRewardAddress);
      await time.increase(2);
      expect(await easyStaking.liquidityProvidersRewardAddress()).to.be.bignumber.equal(newLiquidityProvidersRewardAddress);
    });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.setLiquidityProvidersRewardAddress(user1, { from: user1 }),
        ACL_ERROR,
      );
    });
    it('fails if equal to zero', async () => {
      await expectRevert(
        easyStaking.setLiquidityProvidersRewardAddress(constants.ZERO_ADDRESS, { from: owner }),
        'zero address'
      );
    });
    it('fails if equal to the address of EasyStaking contract', async () => {
      await expectRevert(
        easyStaking.setLiquidityProvidersRewardAddress(easyStaking.address, { from: owner }),
        'wrong address'
      );
    });
  });
  describe('claimTokens', () => {
    it('should claim tokens', async () => {
      const value = ether('10');
      const anotherToken = await MockToken.new();
      await anotherToken.transfer(user1, value)
      expect(await anotherToken.balanceOf(user1)).to.be.bignumber.equal(value);
      await anotherToken.transfer(easyStaking.address, value, { from: user1 });
      expect(await anotherToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(value);
      expect(await anotherToken.balanceOf(owner)).to.be.bignumber.equal(new BN(0));
      await easyStaking.claimTokens(anotherToken.address, owner, value, { from: owner });
      expect(await anotherToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(new BN(0));
      expect(await anotherToken.balanceOf(owner)).to.be.bignumber.equal(value);
    });
    it('should claim CYT tokens', async () => {
      let user1BalanceBefore = await stakeToken.balanceOf(user1)

      stakeToken.increaseAllowance(easyStaking.address, ether('10'))
      easyStaking.depositReserve(ether('10'))
      await stakeToken.transfer(user1, ether('100'), { from: owner });
      expect(await stakeToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(ether('10'));
      expect(await stakeToken.balanceOf(user1)).to.be.bignumber.equal(user1BalanceBefore.add(ether('100')));
      await stakeToken.transferAndCall(easyStaking.address, ether('100'), { from: user1 });
      expect(await stakeToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(ether('110'));
      let ownerBalance = await stakeToken.balanceOf(owner);
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(ether('100'));
      await easyStaking.claimTokens(stakeToken.address, owner, ether('10'), { from: owner });
      expect(await stakeToken.balanceOf(easyStaking.address)).to.be.bignumber.equal(ether('100'));
      expect(await stakeToken.balanceOf(owner)).to.be.bignumber.equal(ownerBalance.add(ether('10')));
      expect(await easyStaking.balances(user1, 1)).to.be.bignumber.equal(ether('100'));
      await expectRevert(easyStaking.claimTokens(stakeToken.address, owner, ether('10'), { from: owner }), 'insufficient funds');
    });
    async function claimEtherAndSend(to) {
      easyStaking = await initialize();
      const value = ether('10');
      expect(await balance.current(easyStaking.address)).to.be.bignumber.equal(new BN(0));
      await send.ether(user1, easyStaking.address, value);
      expect(await balance.current(easyStaking.address)).to.be.bignumber.equal(value);
      const balanceBefore = await balance.current(to);
      await easyStaking.claimTokens(constants.ZERO_ADDRESS, to, value, { from: owner, gasPrice: 0 });
      expect(await balance.current(easyStaking.address)).to.be.bignumber.equal(new BN(0));
      expect(await balance.current(to)).to.be.bignumber.equal(balanceBefore.add(value));
    }
    it('should claim ether', async () => {
      // TODO: fail revert
      // await claimEtherAndSend(owner)
      // easyStaking = await initialize();
      // const value = ether('10');
      // expect(await balance.current(easyStaking.address)).to.be.bignumber.equal(new BN(0));
      // await send.ether(user1, easyStaking.address, value);
      // expect(await balance.current(easyStaking.address)).to.be.bignumber.equal(value);
      // const balanceBefore = await balance.current(to);
      // await easyStaking.claimTokens(constants.ZERO_ADDRESS, owner, value, { from: owner, gasPrice: 0 });
      // expect(await balance.current(easyStaking.address)).to.be.bignumber.equal(new BN(0));
      // expect(await balance.current(owner)).to.be.bignumber.equal(balanceBefore.add(value));

    });
    // it('should claim and send ether even if receiver reverts it', async () => {
    //   const receiver = await ReceiverMock.new();
    //   await claimEtherAndSend(receiver.address);
    // });
    it('fails if not an owner', async () => {
      await expectRevert(
        easyStaking.claimTokens(constants.ZERO_ADDRESS, owner, ether('1'), { from: user1 }),
        ACL_ERROR,
      );
    });
    it('fails if invalid recipient', async () => {
      await expectRevert(
        easyStaking.claimTokens(constants.ZERO_ADDRESS, constants.ZERO_ADDRESS, ether('1'), { from: owner }),
        'not a valid recipient',
      );
      await expectRevert(
        easyStaking.claimTokens(constants.ZERO_ADDRESS, easyStaking.address, ether('1'), { from: owner }),
        'not a valid recipient',
      );
    });
    it('fails if zero amount', async () => {
      await expectRevert(
        easyStaking.claimTokens(constants.ZERO_ADDRESS, owner, 0, { from: owner }),
        'amount should be greater than 0',
      );
    });
  });
  describe('getSupplyBasedEmissionRate', () => {
    it('should be calculated correctly', async () => {
      const value = ether('3000000');
      const totalSupply = await stakeToken.totalSupply()
      await stakeToken.transfer(user1, value, { from: owner });
      await stakeToken.approve(easyStaking.address, value, { from: user1 });
      await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      const totalStaked = value;
      const supplyBasedEmissionRate1 = calculateSupplyBasedEmissionRate(totalSupply, totalStaked);
      expect(await easyStaking.getSupplyBasedEmissionRate()).to.be.bignumber.equal(supplyBasedEmissionRate1);
      const newTotalSupplyFactor = ether('0.7');
      await easyStaking.setTotalSupplyFactor(newTotalSupplyFactor);
      const supplyBasedEmissionRate2 = calculateSupplyBasedEmissionRate(totalSupply, totalStaked, newTotalSupplyFactor);
      await time.increase(PARAM_UPDATE_DELAY.add(new BN(1)));
      expect(await easyStaking.getSupplyBasedEmissionRate()).to.be.bignumber.equal(supplyBasedEmissionRate2);
      expect(supplyBasedEmissionRate1).to.be.bignumber.equal(supplyBasedEmissionRate2.mul(newTotalSupplyFactor).div(oneEther))
    });
    it(`can't be more than 7.5%`, async () => {
      const maxSupplyBasedEmissionRate = MAX_EMISSION_RATE.div(new BN(2));
      const totalSupply = await stakeToken.totalSupply()
      await stakeToken.transferAndCall(easyStaking.address, totalSupply.div(new BN(2)), { from: owner });
      expect(await easyStaking.getSupplyBasedEmissionRate()).to.be.bignumber.equal(maxSupplyBasedEmissionRate.div(new BN(2)));
      await easyStaking.setTotalSupplyFactor(ether('0.5'));
      await time.increase(PARAM_UPDATE_DELAY.add(new BN(1)));
      expect(await easyStaking.getSupplyBasedEmissionRate()).to.be.bignumber.equal(maxSupplyBasedEmissionRate);
      await stakeToken.transferAndCall(easyStaking.address, totalSupply.div(new BN(3)), { from: owner }); // less than half left
      expect(await easyStaking.getSupplyBasedEmissionRate()).to.be.bignumber.equal(maxSupplyBasedEmissionRate);
    });
  });
  describe('getAccruedEmission', () => {
    it('should be calculated correctly', async () => {
      const value = ether('100');
      await stakeToken.transfer(user1, value, { from: owner });
      await stakeToken.approve(easyStaking.address, value, { from: user1 });
      const receipt = await easyStaking.methods['deposit(uint256)'](value, { from: user1 });
      const timestampBefore = await getBlockTimestamp(receipt);
      await time.increase(YEAR.div(new BN(8)));
      await time.advanceBlock();
      const timestampAfter = await time.latest();
      const timePassed = timestampAfter.sub(timestampBefore);
      const totalSupply = await stakeToken.totalSupply();
      const totalStaked = await easyStaking.totalStaked();
      const depositDate = await easyStaking.depositDates(user1, 1);
      const userAccruedEmission = calculateUserAccruedEmission(value, timePassed, totalSupply, totalStaked);
      const accruedEmissionResp = await easyStaking.getAccruedEmission(depositDate, value);
      expect(accruedEmissionResp.timePassed).to.be.bignumber.equal(timePassed);
      // FIXME
      // expect(accruedEmissionResp.userShare).to.be.bignumber.equal(userAccruedEmission);
    });
  });
  describe('ExtendedMath', () => {
    let extendedMath;
    beforeEach(async () => {
      extendedMath = await ExtendedMathMock.new();
    });
    it('sqrt should be within the gas limit and calculated correctly', async () => {
      let inputs = [constants.MAX_UINT256];
      for (let d = 2; d <= 9; d++) {
        inputs.push(constants.MAX_UINT256.div(new BN(d)));
      }
      for (let m = 1; m <= 50; m++) {
        inputs.push(constants.MAX_UINT256.div((new BN(10)).pow(new BN(m))));
      }
      for (let i = 0; i < inputs.length; i++) {
        const value = inputs[i];
        const { receipt } = await extendedMath.sqrt(value);
        const expectedValue = squareRoot(value);
        // expect(receipt.gasUsed).to.be.lt(57000);
        expect(await extendedMath.squareRoot()).to.be.bignumber.equal(expectedValue);
      }
    });
    it('sqrt of 0-3', async () => {
      await extendedMath.sqrt(0);
      expect(await extendedMath.squareRoot()).to.be.bignumber.equal(new BN(0));
      for (let i = 1; i < 4; i++) {
        await extendedMath.sqrt(i);
        expect(await extendedMath.squareRoot()).to.be.bignumber.equal(new BN(1));
      }
    });
    it('pow2 of 0', async () => {
      await extendedMath.pow2(0);
      expect(await extendedMath.squaredValue()).to.be.bignumber.equal(new BN(0));
    });
  });
});
