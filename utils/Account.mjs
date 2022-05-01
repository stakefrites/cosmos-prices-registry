import { fromBech32, normalizeBech32, toBech32 } from "@cosmjs/encoding";
import axios from "axios";
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

export class Chains {
  constructor(enabled) {
    this.enabled = enabled;
    this.chains = [];
    this.tokens = [];
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

  async fetchTokens() {
    const directory = CosmosDirectory();
    let chains = await directory.getChains();
    chains = Object.values(chains);
    const allTokens = await mapAsync(chains, async (c) => {
      const tokenData = await directory.getTokenData(c.name);
      return tokenData.assets.map((a) => {
        return {
          base: a.base,
          symbol: a.symbol,
          image: a.logo_URIs.png ? a.logo_URIs.png : a.logo_URIs.svg,
          decimals: a.denom_units.find((u) => u.exponent !== 0).exponent,
          coingecko_id: a.coingecko_id,
          name: a.name,
        };
      });
    });

    this.tokens = _.compact(allTokens.flat());
  }
}

export class Account {
  constructor(address, chains) {
    this.address = address;
    this.chains = chains;
  }

  fetch = async () => {
    await this.getAddresses();
    await this.getAllBalances();
    await this.getOsmosisLp();
    await this.total();
  };

  getLp = async () => {
    await this.getAddresses();
    await this.getOsmosisLp();
    return this.lp;
  };
  getAddresses = () => {
    const decoded = fromBech32(this.address);
    this.addresses = this.chains.map((c) => ({
      name: c.name,
      denom: c.denom,
      base: c.base,
      symbol: c.symbol,
      coingecko_id: c.coingecko_id,
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

  async getOsmosisLp() {
    try {
      const address = toBech32("osmo", fromBech32(this.address).data);
      const rest = "https://api-osmosis.imperator.co/";
      const locked = await axios.get(
        "https://lcd-osmosis.keplr.app/osmosis/lockup/v1beta1/account_locked_coins/" +
          address
      );
      const lockedCoins = locked.data.coins;
      const rpc = _.keyBy(this.chains, "name").osmosis.best_apis.rpc[0].address;
      const client = await makeClient(rpc);
      const balances = await client.bank.allBalances(address);

      const path = rest + "tokens/v2/all";
      const tokensData = await axios.get(path);
      const allTokens = tokensData.data.map(
        ({ price, denom, symbol, exponent }) => ({
          price,
          denom,
          symbol,
          exponent,
        })
      );
      const pairsData = await axios.get(rest + "pairs/v1/summary");
      const allPairs = pairsData.data;
      const objPairs = _.keyBy(allPairs.data, "pool_id");
      let tokens = await mapAsync(lockedCoins, async (b) => {
        let data = allTokens.find((t) => t.denom == b.denom);

        if (!data) {
          const poolId = b.denom.split("/")[2];
          const supply = await client.bank.supplyOf(b.denom);
          let liquidity = objPairs[poolId].liquidity;
          let value = (b.amount / supply.amount) * liquidity;
          let realAmount = b.amount / Math.pow(10, 18);
          let price = value / realAmount;
          data = {
            ...b,
            symbol:
              objPairs[poolId].base_symbol +
              "/" +
              objPairs[poolId].quote_symbol,
            price,
            amount: realAmount,
          };
        } else {
          data = {
            ...b,
            ...data,
            amount: parseInt(b.amount) / Math.pow(10, data.exponent),
          };
        }

        return data;
      });
      const lpTokens = tokens.filter((t) => t.denom.includes("gamm"));
      this.lp = lpTokens;
      return lpTokens;
    } catch (error) {
      console.log(error.message);
    }
  }
  getBalances = async () => {
    return await mapAsync(this.addresses, async (a) => {
      const client = await makeClient(a.rpc);
      const allBalances = await client.bank.allBalances(a.address);
      const denoms = await this.getIbcDenoms(allBalances, client);
      const parsedDenoms = denoms.map((d) => {
        return {
          denom: d.denom,
          amount: parseInt(d.amount),
          ibcDenom: d.ibcDenom ? d.ibcDenom : false,
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
            amount: parseInt(d.balance.amount),
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
      const chainRewards =
        rewards.rewards.length > 0
          ? rewards.rewards.map((d) => {
              return d.reward.length > 0
                ? {
                    validator: d.validatorAddress,
                    amount: {
                      amount: parseInt(d.reward[0].amount) / Math.pow(10, 18),
                      denom: d.reward[0].denom,
                    },
                  }
                : {
                    validator: d.validatorAddress,
                    amount: {
                      amount: 0,
                      denom: a.base,
                    },
                  };
            })
          : [
              {
                amount: {
                  amount: 0,
                  denom: a.base,
                },
              },
            ];

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

  total = () => {
    try {
      const networks = {};
      const liquidBalances = this.allBalances.map((b) => {
        const base = b.base;
        networks[b.name] = {};
        networks[b.name].rewards = b.allBalances.rewards
          ? b.allBalances.rewards.total
          : 0;
        networks[b.name].staked = b.allBalances.staked.total;
        networks[b.name].liquid =
          b.allBalances.liquid.liquid.length > 0
            ? b.allBalances.liquid.liquid.find((b) => b.denom === base)
            : 0;
        networks[b.name].foreign = b.allBalances.liquid.liquid.filter(
          (b) => b.denom !== base && !b.denom.includes("gamm")
        );
        const liquid = b.allBalances.liquid.liquid;
        return liquid;
      });
      const liquid = _.concat(liquidBalances);
      const staked = this.allBalances.map((b) => b.allBalances.staked.total);
      const rewards = this.allBalances.map((b) => b.allBalances.rewards.total);
      const arr = [...liquid, ...staked, ...rewards].flat();
      const total = {};
      const stakedO = {};
      const rewardsO = {};
      const liquidO = {};
      const locked = {};
      const foreign = {};
      for (let b of arr) {
        if (total[b.denom]) {
          total[b.denom] = b.amount + total[b.denom];
        } else {
          total[b.denom] = b.amount;
        }
      }
      for (let c of staked) {
        stakedO[c.denom] = c.amount;
      }
      for (let c of rewards) {
        rewardsO[c.denom] = c.amount;
      }
      liquid
        .flat()
        .filter((f) => f.ibcDenom)
        .map((l) => {
          foreign[l.denom] = 0;
          foreign[l.denom] += l.amount;
        });

      for (let c of liquid) {
        for (let d of c) {
          liquidO[d.denom] = d.amount;
        }
      }

      const networksWithBonded = {
        ...networks,
        osmosis: {
          ...networks.osmosis,
          bonded: this.lp,
        },
      };

      const transform = (o) => {
        return Object.entries(o).map(([k, v]) => ({
          denom: k,
          amount: v,
        }));
      };

      const totalArray = [...this.lp, ...transform(total)];

      const res = {
        total: totalArray,
        foreign: transform(foreign),
        staked: transform(stakedO),
        rewards: transform(rewardsO),
        liquid: transform(liquidO),
        bonded: this.lp,
        networks: networksWithBonded,
      };
      this.total = res;
      return res;
    } catch (error) {
      console.log(error.message);
      return { error: true };
    }
  };
}
