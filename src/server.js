import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { clerkMiddleware } from "@clerk/express";
import { serve } from "inngest/express";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import cors from "cors";
import { ENV } from "./config/env.js";
import adminRoutes from "./routes/admin.route.js";

import { connectDB } from "./config/db.js";
import { inngest, functions } from "./config/inngest.js";

const app = express();

app.use(express.json());
app.use(clerkMiddleware()); // adds auth object under the req => req.auth
app.use(cors({ origin: ENV.CLIENT_URL, credentials: true })); // credentials: true allows the browser to send the cookies to the server with the request

app.use("/api/inngest", serve({ client: inngest, functions }));

app.use("/api/admin", adminRoutes);

// make our app ready for deployment
if (ENV.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "../admin/dist")));

  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../admin", "dist", "index.html"));
  });
}

const startServer = async () => {
  console.log("Starting server boot sequence...");
  console.log("Attempting to connect to MongoDB...");
  
  await connectDB();
  console.log("✅ Database connection established");

  const port = ENV.PORT || 5000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`✅ Server is running and listening on port ${port} (0.0.0.0)`);
  });
};

startServer();
