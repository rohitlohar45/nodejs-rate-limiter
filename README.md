# nodejs-rate-limiter

`nodejs-rate-limiter` is a middleware library for rate limiting in Express applications using Redis as the storage backend. It allows you to control the rate of incoming requests from clients and protect your server from excessive traffic.

## Installation

Install the package via npm:

```shell
npm install nodejs-rate-limiter
```

## Usage

To use `nodejs-rate-limiter` in your Express application, follow these steps:

1. Import the necessary modules:

   ```javascript
   import express from "express";
   import { RateLimiter } from "nodejs-rate-limiter";
   import { createClient } from "redis"; // For node-redis
   import ioredis from "ioredis"; // For ioredis
   ```

2. Create an instance of the Redis client and connect to the Redis server:

   ```javascript
   // For node-redis
   const client = createClient();
   await client.connect();

   // For ioredis
   const client = new ioredis();
   ```

3. Configure and create the rate limiter middleware:

   3.1 Creating a rate limiter using `node-redis`:

   ```javascript
   const limiter = new RateLimiter({
     expiresIn: 3600, // Rate limiter will expire after 3600 seconds (1 hour)
     key: (req) => req.ip, // Use the IP address of the request as the key to identify the client
     max: 300, // Maximum number of requests allowed per client within the defined duration
     store: (...args) => client.sendCommand(args), // A callback function to execute Redis commands for storing and retrieving information about the client in the rate limiter
     message: "You have exceeded the maximum number of requests.", // Optional message to send when rate limit is exceeded
     algorithm: "token-bucket", // Select the rate limiting algorithm (optional, defaults to "token-bucket")
   });
   ```

   3.2 Creating a rate limiter using `ioredis`:

   ```javascript
   const limiter = new RateLimiter({
     expiresIn: 3600, // Rate limiter will expire after 3600 seconds (1 hour)
     key: (req) => req.ip, // Use the IP address of the request as the key to identify the client
     max: 300, // Maximum number of requests allowed per client within the defined duration
     store: (...args) => client.call(...args), // A callback function to execute Redis commands for storing and retrieving information about the client in the rate limiter
     message: "You have exceeded the maximum number of requests.", // Optional message to send when rate limit is exceeded
     algorithm: "fixed-window", // Select the rate limiting algorithm (optional, defaults to "token-bucket")
   });
   ```

4. Apply the rate limiter middleware to your Express application:

   ```javascript
   const app = express();

   app.use(limiter);

   // Define your routes and application logic here...

   app.listen(3000, () => {
     console.log("Server is running on port 3000");
   });
   ```

## Rate Limiter Options

The following options are available when configuring the rate limiter:

- `expiresIn` (number): The expiration time of the rate limiter in milliseconds.
- `key` ((req: Request) => string): A function that returns the key to identify the client in the rate limiter storage.
- `max` (number): The maximum number of requests allowed per client within the defined duration.
- `store` ((...args: string[]) => any): A callback function to execute Redis commands for storing and retrieving information about the client in the rate limiter.
- `message` (string, optional): An optional message to send along with the error response when the rate limit is exceeded.
- `algorithm` (string, optional): The algorithm used for rate limiting. Supported values are: "token-bucket", "fixed-window", "sliding-window", "leaky-bucket", "sliding-log".

## Rate Limiting Algorithms

- **Token Bucket**: Distributes a fixed number of tokens at a constant rate.
- **Fixed Window**: Resets the request count at regular intervals.
- **Sliding Window**: Tracks the request count over a sliding time window.
- **Leaky Bucket**: Empties the bucket at a constant rate, allowing bursts of requests.
- **Sliding Log**: Tracks requests using a logarithmic sliding window.

## Example: Applying Rate Limiter to a Specific Route

You can also apply the rate limiter middleware to specific routes. Here's an example of applying the rate limiter to a login route:

```javascript
const loginLimiter = new RateLimiter({
  expiresIn: 3600,
  key: (req) => req.ip + req.originalUrl,
  max: 15,
  store: (...args) => client.sendCommand(args),
  message: "You have reached the maximum number of login attempts.", // Optional message to send when rate limit is exceeded
});

app.post("/login", loginLimiter.middleware(), (req, res) => {
  // Route logic
});
```

## Response Headers

When using `nodejs-rate-limiter`, several custom headers can be added to the response to provide information about the rate limit. These headers can be used by the client to understand the rate limiting status and adjust their requests accordingly.

- `X-Rate-Limit-Limit`: Represents the maximum number of requests allowed per client within the defined duration (`max` value from the rate limiter options).
- `X-Rate-Limit-Remaining`: Indicates the remaining number of requests that the client can make within the defined duration. If the value is negative, it means the client has exceeded the rate limit and no more requests are allowed.
- `X-Rate-Limit-Duration`: Specifies the total duration of the rate limit in seconds. It represents the length of time for which the rate limit is set.
