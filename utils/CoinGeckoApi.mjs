import axios from "axios";

class CoinGeckoApi {
  constructor() {
    this.baseUrl = "https://api.coingecko.com/api/";
    this.version = "v3/";
  }
  async getPrice(id) {
    try {
      const response = await axios.get(
        this.baseUrl + this.version + "simple/price",
        {
          params: {
            ids: id,
            vs_currencies: "usd,cad,eur",
          },
        }
      );
      if (response.status == 200 && response.data[id]) {
        return response.data;
      } else {
        return { [id]: false };
      }
    } catch (error) {
      console.log(error.message);
    }
  }
  async get14DaysMarketChartByCurrency(id, currency) {
    try {
      const response = await axios.get(
        this.baseUrl + this.version + id + "/market_chart",
        {
          params: {
            vs_currency: currency,
            days: 14,
            interval: "daily",
          },
        }
      );
      return response.data;
    } catch (error) {
      console.log(error.message);
    }
  }
}

export default CoinGeckoApi;
