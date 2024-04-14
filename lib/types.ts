import { NextFunction, Request, Response } from "express";

export interface IRateLimiterParams {
  expiresIn: number;
  max: number;
  message?: string;
  key: (req: Request) => string;
  whiteList?: string[];
  store: (...args: string[]) => any;
  algorithm: string;
}

export interface IRateLimiter {
  resetKey(key: string): Promise<void>;
  runScript(...args: string[]): Promise<any>;
  generateSha(script: string): Promise<string>;
  validate(args: IRateLimiterParams): void;
  middleware(): (
    req: Request,
    res: Response,
    next: NextFunction
  ) => Promise<void>; // Change middleware signature
}

export {};

declare module "express" {
  interface Request {
    resetKey(key: string): Promise<void>;
  }
}
