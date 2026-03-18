require('dotenv').config();
const { MongoClient } = require('mongodb');
const atlasURI = process.env.MONGODB_URI;
const client = new MongoClient(atlasURI);

let database;

async function connectToDB() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas!");
    database = client.db('users'); // Your actual DB name
    return database;
  } catch (err) {
    console.error("❌ MongoDB connection error:", err);
    throw err;
  }
}

module.exports = { connectToDB, client };
