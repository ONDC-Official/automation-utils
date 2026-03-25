import mongoose from "mongoose";

export async function connectDB() {
    // Skip SSH tunnel for local MongoDB
    const db = process.env.MONGO_DB ?? "test";
    const host = process.env.MONGO_HOST ?? "localhost";
    const port = process.env.MONGO_PORT ?? "27017";
    const uri = `mongodb://${host}:${port}/${db}`;

    console.log(`[db] Connecting to MongoDB at ${uri}`);

    try {
        await mongoose.connect(uri, {
            directConnection: true,
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
        });

        const conn = mongoose.connection;
        console.log(`[db] Connected to MongoDB`);
        console.log(`[db] Host     : ${conn.host}:${conn.port}`);
        console.log(`[db] Database : ${conn.name}`);

        const collections = await conn.listCollections();
        console.log("[db] Collections:", JSON.stringify(collections, null, 2));
    } catch (err) {
        console.error("[db] MongoDB connection failed:", err);
        throw err;
    }
}
