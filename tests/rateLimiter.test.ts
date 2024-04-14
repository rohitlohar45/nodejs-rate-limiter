import request from "supertest";
import express, { Request, Response, NextFunction } from "express";
import { RateLimiter } from "../lib/lib"; // Import your RateLimiter class

// Initialize Express app
const app = express();

// Initialize rate limiter with your desired parameters
const limiter = new RateLimiter({
  expiresIn: 60 * 60, // 3600seconds
  key: (req: Request) => req.ip, // Use client IP address as the key
  max: 10, // Maximum number of requests allowed per client within 10 seconds
  algorithm: "sliding-window", // Choose the algorithm to test
  store: async (command: string, ...args: any[]) => {
    // Mock the Redis store function for testing
    console.log(
      `Mock Redis store function called with command: ${command}, args: ${args}`
    );
    // You can add your own logic here to simulate Redis store operations
    return Promise.resolve("success");
  },
});

// Apply rate limiter middleware to all routes
app.use(limiter.middleware());

// Define a route to test rate limiting
app.get("/", (req: Request, res: Response, next: NextFunction) => {
  res.send("Hello World!");
});

describe("Rate Limiter", () => {
  it("should allow requests below rate limit", async () => {
    // Send multiple requests within the rate limit
    const responsePromises = [];
    for (let i = 0; i < 5; i++) {
      responsePromises.push(request(app).get("/"));
    }
    const responses = await Promise.all(responsePromises);
    // Check that all responses have status code 200
    responses.forEach((response) => {
      expect(response.status).toBe(200);
    });
  });

  it("should block requests above rate limit", async () => {
    // Send requests above the rate limit
    const responsePromises = [];
    for (let i = 0; i < 15; i++) {
      responsePromises.push(request(app).get("/"));
    }
    const responses = await Promise.all(responsePromises);
    // Check that all responses above the rate limit have status code 429 (Too Many Requests)
    responses.slice(10).forEach((response) => {
      expect(response.status).toBe(429);
    });
  });
});
