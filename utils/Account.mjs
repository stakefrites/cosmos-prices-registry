import bigInt from "big-integer";

import { fromBech32, normalizeBech32, toBech32 } from "@cosmjs/encoding";
import { Decimal } from "@cosmjs/math";
import CosmosDirectory from "./CosmosDirectory.mjs";
import _ from "lodash";
import {
  setupStakingExtension,
  QueryClient as CosmjsQueryClient,
  setupBankExtension,
  setupDistributionExtension,
  setupMintExtension,
  setupGovExtension,
  setupIbcExtension,
} from "@cosmjs/stargate";
import { Tendermint34Client } from "@cosmjs/tendermint-rpc";

const mapAsync = async (array, fn) => {
  let promises = await Promise.allSettled(array.map(fn));
  return promises.map((p) => {
    if (p.status == "fulfilled") {
      return p.value;
    } else {
      return false;
    }
  });
};

const makeClient = async (rpcUrl) => {
  const tmClient = await Tendermint34Client.connect(rpcUrl);
  return CosmjsQueryClient.withExtensions(
    tmClient,
    setupStakingExtension,
    setupIbcExtension,
    setupBankExtension,
    setupDistributionExtension,
    setupMintExtension,
    setupGovExtension
  );
};

class Chains {
  constructor(enabled) {
    this.enabled = enabled;
    this.chains = [];
  }
  async init() {
    const directory = CosmosDirectory();
    let chains = await directory.getChains();
    chains = Object.values(chains).filter((c) => this.enabled.includes(c.name));
    this.chains = await mapAsync(chains, async (c) => {
      const chainData = await directory.getChainData(c.name);
      const tokenData = await directory.getTokenData(c.name);
      return {
        ...c,
        prefix: chainData.bech32_prefix,
        base: tokenData.assets[0].base,
        decimals: c.decimals,
      };
    });
  }
}

class Account {
  constructor(address, chains) {
    this.address = address;
    this.chains = chains;
  }

  fetch = async () => {
    await this.getAddresses();
    await this.getAllBalances();
  };
  getAddresses = () => {
    const decoded = fromBech32(this.address);
    this.addresses = this.chains.map((c) => ({
      name: c.name,
      denom: c.denom,
      base: c.base,
      address: toBech32(c.prefix, decoded.data),
      rpc: c.best_apis.rpc[0].address,
      decimals: c.decimals,
    }));
  };

  getIbcDenoms = async (coins, client) => {
    return await mapAsync(coins, async (c) => {
      if (c.denom.includes("ibc")) {
        const hash = c.denom.split("/")[1];
        const denomTrace = await client.ibc.transfer.denomTrace(hash);
        return {
          denom: denomTrace.denomTrace.baseDenom,
          amount: c.amount,
          ibcDenom: c.denom,
        };
      } else {
        return c;
      }
    });
  };
  getBalances = async () => {
    return await mapAsync(this.addresses, async (a) => {
      const client = await makeClient(a.rpc);
      const allBalances = await client.bank.allBalances(a.address);
      const denoms = await this.getIbcDenoms(allBalances, client);
      const parsedDenoms = denoms.map((d) => {
        return {
          ...d,
          amount: parseInt(d.amount) / Math.pow(10, a.decimals),
        };
      });
      return {
        address: a.address,
        liquid: parsedDenoms,
      };
    });
  };

  getStaked = async () => {
    return await mapAsync(this.addresses, async (a) => {
      const client = await makeClient(a.rpc);
      const staked = await client.staking.delegatorDelegations(a.address);
      const chainStaked = staked.delegationResponses.map((d) => {
        return {
          validator: d.delegation.validatorAddress,
          amount: {
            amount: parseInt(d.balance.amount) / Math.pow(10, a.decimals),
          },
        };
      });
      const total =
        chainStaked.length !== 0
          ? chainStaked
              .map((s) => s.amount.amount)
              .reduce((prev, curr) => {
                return prev + curr;
              })
          : 0;
      return {
        delegations: chainStaked,
        address: a.address,
        total: {
          amount: total,
          denom: a.denom,
        },
      };
    });
  };

  getRewards = async () => {
    return await mapAsync(this.addresses, async (a) => {
      const client = await makeClient(a.rpc);
      const rewards = await client.distribution.delegationTotalRewards(
        a.address
      );
      const chainRewards = rewards.rewards.map((d) => {
        return {
          validator: d.validatorAddress,
          amount: {
            amount:
              parseInt(d.reward[0].amount) / Math.pow(10, 18 + a.decimals),
            denom: d.reward[0].denom,
          },
        };
      });
      const total =
        chainRewards.length !== 0
          ? chainRewards
              .map((s) => s.amount.amount)
              .reduce((prev, curr) => {
                return prev + curr;
              })
          : 0;
      return {
        rewards: chainRewards,
        address: a.address,
        total: {
          amount: total,
          denom: a.denom,
        },
      };
    });
  };
  getAllBalances = async () => {
    const liquid = await this.getBalances();
    const staked = await this.getStaked();
    const rewards = await this.getRewards();
    const s = _.keyBy(staked, "address");
    const r = _.keyBy(rewards, "address");
    const l = _.keyBy(liquid, "address");
    const allBalances = this.addresses.map((a) => {
      return {
        name: a.name,
        address: a.address,
        base: a.base,
        allBalances: {
          rewards: r[a.address],
          liquid: l[a.address],
          staked: s[a.address],
        },
      };
    });
    this.allBalances = allBalances;
    return allBalances;
  };

  total = async () => {
    const liquidBalances = this.allBalances.map((b) => {
      const base = b.base;
      const liquid = b.allBalances.liquid.liquid;
      return liquid;
    });
    const liquid = _.concat(liquidBalances);
    const staked = this.allBalances.map((b) => b.allBalances.staked.total);
    const rewards = this.allBalances.map((b) => b.allBalances.rewards.total);
    const arr = [...liquid, ...staked, ...rewards].flat();
    const total = {};
    for (let b of arr) {
      if (total[b.denom]) {
        total[b.denom] = b.amount + total[b.denom];
      } else {
        total[b.denom] = b.amount;
      }
    }
    return total;
  };
}

export default Account;
