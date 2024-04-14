import { RateLimiter } from "./lib";
import { IRateLimiterParams } from "./types";
module.exports = (args: IRateLimiterParams) =>
  new RateLimiter(args).middleware();
