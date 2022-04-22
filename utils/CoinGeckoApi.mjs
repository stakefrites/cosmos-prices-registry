import axios from "axios";


class CoinGeckoApi { 
    async getPrice(id, currency) {
        const response = await axios.get("https://api.coingecko.com/api/v3/simple/price", {
            params: {
                ids: id,
                vs_currencies: "usd,cad,eur"
            }
        });
        if (response.status == 200) {
            return response.data;
        } else { 
            return {[id]: "Error"}
        }
    }
}

export default CoinGeckoApi;