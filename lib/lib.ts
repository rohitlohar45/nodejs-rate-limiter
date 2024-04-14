import { NextFunction, Request, Response } from "express";
import { IRateLimiter, IRateLimiterParams } from "./types";

export class RateLimiter implements IRateLimiter {
  config: IRateLimiterParams;

  constructor(private readonly args: IRateLimiterParams) {
    this.validate(args);
    this.config = args;
  }

  async resetKey(key: string): Promise<void> {
    try {
      const sha = await this.generateSha(`redis.call("DEL", KEYS[1])`);
      await this.config.store("EVALSHA", sha, "1", key);
    } catch (error) {
      console.error("Error resetting key:", error);
      throw error; // Re-throw the error for handling at a higher level
    }
  }

  async runScript(...args: string[]): Promise<any> {
    try {
      const sha = await this.generateSha(args[0]);
      return await this.config.store("EVALSHA", sha, ...args.slice(1));
    } catch (error) {
      console.error("Error running script:", error);
      throw error; // Re-throw the error for handling at a higher level
    }
  }

  middleware() {
    const algorithm = this.selectAlgorithm();
    return async (
      req: Request,
      res: Response,
      next: NextFunction
    ): Promise<void> => {
      try {
        await algorithm(req, res, next);
        // Ensure the function always resolves with void
        return Promise.resolve();
      } catch (error) {
        // Handle errors here if necessary
        next(error);
      }
    };
  }

  async generateSha(script: string): Promise<string> {
    return await this.config.store("SCRIPT", "LOAD", script);
  }

  public validate(args: IRateLimiterParams): void {
    if (typeof args.expiresIn !== "number") {
      throw new Error("ExpiresIn field must be a number");
    }
    if (args.whiteList && !Array.isArray(args.whiteList)) {
      throw new Error("WhiteList field must be a string list");
    }
    if (typeof args.store !== "function") {
      throw new Error("Store field must be a function");
    }
    if (typeof args.key !== "function") {
      throw new Error("key field must be a function");
    }
    if (
      !args.algorithm ||
      ![
        "token-bucket",
        "fixed-window",
        "leaky-bucket",
        "sliding-window",
        "sliding-log",
      ].includes(args.algorithm)
    ) {
      throw new Error("Invalid or missing algorithm");
    }
  }

  // Method to select algorithm based on config
  selectAlgorithm(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void> {
    switch (this.config.algorithm) {
      case "token-bucket":
        return this.tokenBucketAlgorithm();
      case "fixed-window":
        return this.fixedWindowAlgorithm();
      case "sliding-window":
        return this.slidingWindowAlgorithm();
      case "leaky-bucket":
        return this.leakyBucketAlgorithm();
      case "sliding-log":
        return this.slidingLogAlgorithm();
      // Add other cases for additional algorithms
      default:
        throw new Error("Invalid rate limiter algorithm");
    }
  }

  tokenBucketAlgorithm(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void> {
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = this.config.key(req);
      const now = Date.now();
      const keyExists = await this.config.store("EXISTS", key);
      let currentTokens = 0;

      if (keyExists === 1) {
        const [tokens, lastRefillTime] = await this.config.store(
          "HMGET",
          key,
          "tokens",
          "lastRefillTime"
        );
        const lastRefillTimeMillis = parseInt(lastRefillTime);
        const timeElapsed = now - lastRefillTimeMillis;
        const maxTokens = this.config.max;
        currentTokens =
          parseInt(tokens) +
          (timeElapsed / 1000) * (maxTokens / this.config.expiresIn);
        currentTokens = Math.min(currentTokens, maxTokens);

        if (currentTokens < 1) {
          return next(new Error("Rate limit exceeded"));
        }

        currentTokens -= 1;
        await this.config.store(
          "HMSET",
          key,
          "tokens",
          currentTokens.toString(),
          "lastRefillTime",
          now.toString()
        );
      } else {
        await this.config.store(
          "HMSET",
          key,
          "tokens",
          (this.config.max - 1).toString(),
          "lastRefillTime",
          now.toString()
        );
        await this.config.store(
          "EXPIRE",
          key,
          this.config.expiresIn.toString()
        );
        currentTokens = this.config.max - 1;
      }

      res.set("X-Rate-Limit-Limit", this.config.max.toString());
      res.set("X-Rate-Limit-Remaining", Math.floor(currentTokens).toString());
      res.set("X-Rate-Limit-Duration", this.config.expiresIn.toString());

      next();
    };
  }

  fixedWindowAlgorithm(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void> {
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = this.config.key(req);
      const now = Date.now();
      const keyExists = await this.config.store("EXISTS", key);

      if (keyExists === 1) {
        const [requests, windowStart] = await this.config.store(
          "HMGET",
          key,
          "requests",
          "windowStart"
        );
        const windowStartMillis = parseInt(windowStart);
        const windowEndMillis = windowStartMillis + this.config.expiresIn;

        if (now > windowEndMillis) {
          await this.config.store(
            "HMSET",
            key,
            "requests",
            "1",
            "windowStart",
            now.toString()
          );
        } else {
          console.log("Requests: ", requests);
          const currentRequests = parseInt(requests);
          if (currentRequests >= this.config.max) {
            return next(new Error("Rate limit exceeded"));
          }
          await this.config.store(
            "HSET",
            key,
            "requests",
            (currentRequests + 1).toString()
          );
        }
      } else {
        await this.config.store(
          "HMSET",
          key,
          "requests",
          "1",
          "windowStart",
          now.toString()
        );
        await this.config.store(
          "EXPIRE",
          key,
          this.config.expiresIn.toString()
        );
      }

      res.set("X-Rate-Limit-Limit", this.config.max.toString());
      res.set(
        "X-Rate-Limit-Remaining",
        Math.max(0, this.config.max - 1).toString()
      );
      res.set("X-Rate-Limit-Duration", this.config.expiresIn.toString());

      next();
    };
  }

  slidingWindowAlgorithm(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void> {
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = this.config.key(req);
      const now = Date.now();
      const keyExists = await this.config.store("EXISTS", key);
      const windowStart = now - this.config.expiresIn;

      if (keyExists === 1) {
        const requests = await this.config.store(
          "ZCOUNT",
          key,
          windowStart.toString(),
          now.toString()
        );
        if (requests >= this.config.max) {
          return next(new Error("Rate limit exceeded"));
        }
      } else {
        await this.config.store("ZADD", key, now.toString(), now.toString());
        await this.config.store(
          "EXPIRE",
          key,
          this.config.expiresIn.toString()
        );
      }

      res.set("X-Rate-Limit-Limit", this.config.max.toString());
      res.set(
        "X-Rate-Limit-Remaining",
        Math.max(0, this.config.max - 1).toString()
      );
      res.set("X-Rate-Limit-Duration", this.config.expiresIn.toString());

      next();
    };
  }

  leakyBucketAlgorithm(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void> {
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = this.config.key(req);
      const now = Date.now();
      const keyExists = await this.config.store("EXISTS", key);
      const lastLeak = await this.config.store("HGET", key, "lastLeak");
      const interval = this.config.expiresIn;
      const leakRate = this.config.max / interval;

      if (keyExists === 1) {
        const elapsedTime = now - parseInt(lastLeak);
        const tokensToAdd = elapsedTime * leakRate;
        await this.config.store(
          "HINCRBYFLOAT",
          key,
          "tokens",
          tokensToAdd.toString()
        );
      } else {
        await this.config.store(
          "HMSET",
          key,
          "tokens",
          this.config.max.toString(),
          "lastLeak",
          now.toString()
        );
        await this.config.store("EXPIRE", key, interval.toString());
      }

      const tokens = await this.config.store(
        "HINCRBYFLOAT",
        key,
        "tokens",
        "-1"
      );
      if (tokens < 0) {
        return next(new Error("Rate limit exceeded"));
      }

      res.set("X-Rate-Limit-Limit", this.config.max.toString());
      res.set("X-Rate-Limit-Remaining", Math.floor(tokens).toString());
      res.set("X-Rate-Limit-Duration", interval.toString());

      next();
    };
  }

  slidingLogAlgorithm(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void> {
    return async (req: Request, res: Response, next: NextFunction) => {
      const key = this.config.key(req);
      const now = Date.now();
      const keyExists = await this.config.store("EXISTS", key);
      const logWindowSize = Math.ceil(Math.log2(this.config.expiresIn));

      if (keyExists === 1) {
        // Key exists, check and update request count
        const requests = await this.config.store(
          "ZCOUNT",
          key,
          (now - logWindowSize).toString(),
          now.toString()
        );
        if (requests >= this.config.max) {
          // Rate limit exceeded, call next with an error
          return next(new Error("Rate limit exceeded"));
        }
      } else {
        // Key doesn't exist, create it with initial request count
        await this.config.store("ZADD", key, now.toString(), now.toString());
        await this.config.store(
          "EXPIRE",
          key,
          this.config.expiresIn.toString()
        );
      }

      // Set response headers
      res.set("X-Rate-Limit-Limit", this.config.max.toString());
      res.set(
        "X-Rate-Limit-Remaining",
        Math.max(0, this.config.max - 1).toString()
      );
      res.set("X-Rate-Limit-Duration", this.config.expiresIn.toString());

      // Call next middleware
      next();
    };
  }
}
