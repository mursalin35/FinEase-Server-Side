const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
require("dotenv").config();
const serviceAccount = require("./firebase-admin-key.json");
const app = express();
const port = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const uri = `mongodb+srv://${process.env.USER_DB}:${process.env.PASS_DB}@cluster0.vx3mlx4.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// middleWere
const verifyFirebaseToken = async (req, res, next) => {
  const authorization = req.headers.authorization;
  if (!authorization) {
    return res
      .status(401)
      .send({ message: "unauthorized access token not found " });
  }

  const token = authorization.split(" ")[1];
  try {
    await admin.auth().verifyIdToken(token);
    next();
  } catch (error) {
    res.status(401).send({ message: "unauthorized access" });
  }
};

async function run() {
  try {
    await client.connect();

    const db = client.db("FinEaseDB");
    const transactionCollection = db.collection("transactions");

    // server running
    app.get("/", (req, res) => {
      res.send("FinEase server is running!");
    });

    // transactions:  client > db
    app.post("/transactions", verifyFirebaseToken, async (req, res) => {
      const data = req.body;
      const result = await transactionCollection.insertOne(data);
      res.send(result);
    });
    // -----------------------------------------------------------------
    app.get("/my-transactions", verifyFirebaseToken, async (req, res) => {
      const email = req.query.email;
      if (!email) return res.status(400).send({ error: "Email is required" });

      try {
        const transactions = await transactionCollection
          .find({ userEmail: email })
          .toArray();
        res.send(transactions);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch transactions" });
      }
    });
    // Reports by Type
    app.get("/reports/type", verifyFirebaseToken, async (req, res) => {
      try {
        const { email, month } = req.query;

        if (!email) return res.status(400).json({ error: "Email required" });

        const filter = { userEmail: email };

        if (month) {
          filter.date = { $regex: `^${month}` }; // "2025-11"
        }

        const report = await transactionCollection
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: "$type",
                totalAmount: { $sum: { $toDouble: "$amount" } },
              },
            },
          ])
          .toArray();

        res.json(report);
      } catch (err) {
        res.status(500).json({ error: "Failed to load type report" });
      }
    });

    // Reports by Category
    app.get("/reports/category", verifyFirebaseToken, async (req, res) => {
      try {
        const { email, month } = req.query;

        if (!email) return res.status(400).json({ error: "Email required" });

        const filter = { userEmail: email };

        if (month) {
          filter.date = { $regex: `^${month}` }; // "2025-11"
        }

        const report = await transactionCollection
          .aggregate([
            { $match: filter },
            {
              $group: {
                _id: "$category",
                totalAmount: { $sum: { $toDouble: "$amount" } },
              },
            },
          ])
          .toArray();

        res.json(report);
      } catch (err) {
        res.status(500).json({ error: "Failed to load category report" });
      }
    });

    // Monthly Report
    app.get("/reports/monthly", verifyFirebaseToken, async (req, res) => {
      try {
        const { email } = req.query;
        if (!email) return res.status(400).json({ error: "Email required" });

        const report = await transactionCollection
          .aggregate([
            { $match: { userEmail: email } },
            {
              $addFields: { realDate: { $toDate: "$date" } },
            },
            {
              $group: {
                _id: { $month: "$realDate" }, // 1-12
                totalAmount: { $sum: { $toDouble: "$amount" } },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .toArray();

        res.json(report);
      } catch (err) {
        res.status(500).json({ error: "Failed to load monthly report" });
      }
    });

    // ................................................................................
    // ✅ Reports Overview (Total Balance, Income, Expense)
    app.get("/reports/overview", verifyFirebaseToken, async (req, res) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).json({ error: "Email is required" });
      }

      try {
        // ✅ Total Income
        const incomeData = await transactionCollection
          .aggregate([
            { $match: { userEmail: email, type: "Income" } },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$amount" } },
              },
            },
          ])
          .toArray();

        // ✅ Total Expense
        const expenseData = await transactionCollection
          .aggregate([
            { $match: { userEmail: email, type: "Expense" } },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$amount" } },
              },
            },
          ])
          .toArray();

        const totalIncome = incomeData[0]?.total || 0;
        const totalExpense = expenseData[0]?.total || 0;
        const totalBalance = totalIncome - totalExpense;

        res.send({
          totalIncome,
          totalExpense,
          totalBalance,
        });
      } catch (error) {
        res.status(500).json({ error: "Failed to load overview report" });
      }
    });

    // kkkkkk
    app.get("/transactions/category-total", verifyFirebaseToken, async (req, res) => {
      const { category } = req.query;

      const result = await transactionCollection
        .aggregate([
          { $match: { category: category } },
          {
            $group: {
              _id: null,
              totalAmount: { $sum: { $toDouble: "$amount" } },
            },
          },
        ])
        .toArray();

      res.send({ totalAmount: result[0]?.totalAmount || 0 });
    });

    // ✅ Delete transaction by ID
    app.delete("/transactions/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      try {
        const result = await transactionCollection.deleteOne({
          _id: new ObjectId(id),
        });
        if (result.deletedCount === 1) {
          res.send({ success: true });
        } else {
          res.status(404).send({ error: "Transaction not found" });
        }
      } catch (error) {
        res.status(500).send({ error: "Failed to delete transaction" });
      }
    });

    // ✅ Get transaction details by ID
    app.get("/transactions/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      try {
        const transaction = await transactionCollection.findOne({
          _id: new ObjectId(id),
        });
        if (!transaction) return res.status(404).send({ error: "Not found" });
        res.send(transaction);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch transaction" });
      }
    });

    // ✅ Update transaction by ID
    app.put("/transactions/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body; // { type, category, amount, date }

      try {
        const result = await transactionCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        if (result.matchedCount === 0)
          return res.status(404).send({ error: "Transaction not found" });

        res.send({ success: true });
      } catch (error) {
        res.status(500).send({ error: "Failed to update transaction" });
      }
    });

    // .............................................MongoClient.EventEmitter..................

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server is listening on port ${port}`);
});
