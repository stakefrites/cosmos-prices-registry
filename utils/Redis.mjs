import { createClient } from "redis";

class Cache {
  async init() {
    this.client = createClient({
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PWD,
    });
    await this.client.connect();
  }

  async get(key) {
    return this.client.get(key, (err, data) => {
      if (err) throw err;
      if (data !== null) {
        return data;
      } else {
        return false;
      }
    });
  }

  setCache(key, value) {
    this.client.setEx(key, 3600, JSON.stringify(value));
  }

  async getCache(key) {
    return this.get(key);
  }
}

export default Cache;
