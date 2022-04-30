import axios from "axios";
import {
  setupStakingExtension,
  QueryClient as CosmjsQueryClient,
  setupBankExtension,
  setupDistributionExtension,
  setupMintExtension,
  setupGovExtension,
} from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";
import { fromBech32 } from "@cosmjs/encoding";
import CosmosDirectory from "./CosmosDirectory.mjs";

const directory = CosmosDirectory();

const getTokenInfo = (tokenData, data) => {
  const asset = tokenData.assets[0];
  const base = asset.denom_units.find((el) => el.denom === asset.base);
  const token = asset.denom_units.find((el) => el.denom === asset.display);
  return {
    denom: data.denom || base.denom,
    symbol: data.symbol || token.denom,
    decimals: data.decimals || token.exponent || 6,
    image:
      data.image ||
      (asset.logo_URIs && (asset.logo_URIs.png || asset.logo_URIs.svg)),
    coinGeckoId: asset.coingecko_id,
  };
};

class AprClient {
  constructor(chain) {
    this.chain = chain;
  }

  async init() {
    const tokenData = await directory.getTokenData(this.chain.name);
    this.tokenInfo = getTokenInfo(tokenData, this.chain);
    this.rpcUrl = directory.rpcUrl(this.chain.name);
    this.restUrl = directory.restUrl(this.chain.name);
    const client = await this.makeClient();
    this.client = client;
  }

  async makeClient() {
    const tmClient = await Tendermint34Client.connect(this.rpcUrl);
    return CosmjsQueryClient.withExtensions(
      tmClient,
      setupStakingExtension,
      setupBankExtension,
      setupDistributionExtension,
      setupMintExtension,
      setupGovExtension
    );
  }

  validateAddress = (a) => {
    try {
      fromBech32(a);
      return true;
    } catch (error) {
      console.log(error.message);
      return false;
    }
  };

  async getBalance(address) {
    const liquid = await this.client.bank.allBalances(address);
    const liquidAmount = liquid.find(
      (b) => b.denom == this.tokenInfo.denom
    ).amount;
    return liquidAmount / Math.pow(10, this.tokenInfo.decimals);
  }

  async getStaked(address) {
    const stakingAcc = 0;
    const staked = await this.client.staking.delegatorDelegations(address);
    const totalTokensStaked =
      staked.delegationResponses.length == 0
        ? 0
        : staked.delegationResponses.reduce((acc, item) => {
            return acc + parseInt(item.balance.amount);
          }, stakingAcc);
    const stakedBalance =
      totalTokensStaked / Math.pow(10, this.tokenInfo.decimals);
    return stakedBalance;
  }

  async getRewards(address) {
    const rewardsAcc = 0;
    const rewardsReducer = (acc, item) => {
      if (item.reward.length == 0) {
        return 0;
      } else {
        return acc + parseInt(item.reward[0].amount);
      }
    };
    const rewardsReq = await this.client.distribution.delegationTotalRewards(
      address
    );
    const totalTokensRewards =
      rewardsReq.rewards.length == 0
        ? 0
        : rewardsReq.rewards.reduce(rewardsReducer, rewardsAcc);
    const rewards =
      totalTokensRewards / Math.pow(10, this.tokenInfo.decimals + 18);
    return rewards;
  }

  async getTotalBalances(address) {
    const balances = await this.getBalance(address);
    const rewards = await this.getRewards(address);
    const staked = await this.getStaked(address);
    const total =
      parseFloat(balances) + parseFloat(rewards) + parseFloat(staked);

    const allBalances = {
      liquid: parseFloat(balances),
      staked: parseFloat(staked),
      rewards: parseFloat(rewards),
      total,
    };
    return allBalances;
  }

  async getChainApr() {
    const pool = await this.client.staking.pool();
    const supply = await this.client.bank.supplyOf(this.tokenInfo.denom);
    const bondedTokens = pool.pool.bondedTokens;
    const totalSupply = supply.amount;
    if (this.chain.chain_id.startsWith("osmosis")) {
      const apr = await osmosisApr(totalSupply, bondedTokens);
      return apr;
    } else if (this.chain.chain_id.startsWith("sifchain")) {
      const aprRequest = await axios.get(
        "https://data.sifchain.finance/beta/validator/stakingRewards"
      );
      const apr = aprRequest.data.rate;
      return apr;
    } else {
      const req = await this.client.mint.inflation();
      const baseInflation = req.toFloatApproximation();
      const ratio = bondedTokens / totalSupply;
      const apr = baseInflation / ratio;
      return apr;
    }
  }

  async osmosisApr(totalSupply, bondedTokens) {
    const mintParams = await axios.get(
      restUrl + "/osmosis/mint/v1beta1/params"
    );
    const osmosisEpochs = await axios.get(
      restUrl + "/osmosis/epochs/v1beta1/epochs"
    );
    const epochProvisions = await axios.get(
      restUrl + "/osmosis/mint/v1beta1/epoch_provisions"
    );
    const { params } = mintParams.data;
    const { epochs } = osmosisEpochs.data;
    const { epoch_provisions } = epochProvisions.data;
    const mintingEpochProvision =
      parseFloat(params.distribution_proportions.staking) * epoch_provisions;
    const epochDuration = this.duration(epochs, params.epoch_identifier);
    const yearMintingProvision =
      (mintingEpochProvision * (365 * 24 * 3600)) / epochDuration;
    const baseInflation = yearMintingProvision / totalSupply;
    const bondedRatio = bondedTokens / totalSupply;
    const apr = baseInflation / bondedRatio;
    return apr;
  }

  duration(epochs, epochIdentifier) {
    const epoch = epochs.find((epoch) => epoch.identifier === epochIdentifier);
    if (!epoch) {
      return 0;
    }

    // Actually, the date type of golang protobuf is returned by the unit of seconds.
    return parseInt(epoch.duration.replace("s", ""));
  }
}

export default AprClient;
