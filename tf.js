const apiKey = "40d268fcc3334131a543eb9194d39eee";

const MILISECONDS = 1000;
const SECONDS = 1000;
const MINUTE = 60;

// const tf = require("@tensorflow/tfjs");
const tf = require("@tensorflow/tfjs-node");
const path = require("path");
const ws = require("ws");
const request = require("request");
const { default: axios } = require("axios");
const sc = require("minmaxscaler");

const stockDataRaw = [];
const stockData = [];
const stockDataScaled = [];
const predictDataScaled = [];
let predictedData = [];
// require("@tensorflow/tfjs-node");

// Train for 5 epochs with batch size of 32.
async function trainModel() {
  // const model = tf.sequential({
  //   layers: [
  //     tf.layers.dense({ inputShape: [784], units: 32, activation: "relu" }),
  //     tf.layers.dense({ units: 10, activation: "softmax" }),
  //   ],
  // });
  // model.weights.forEach((w) => {
  //   const newVals = tf.randomNormal(w.shape);
  //   // w.val is an instance of tf.Variable
  //   w.val.assign(newVals);
  // });
  // model.compile({
  //   optimizer: "sgd",
  //   loss: "categoricalCrossentropy",
  //   metrics: ["accuracy"],
  // });
  // // Generate dummy data.
  // const data = tf.randomNormal([100, 784]);
  // const labels = tf.randomUniform([100, 10]);
  // function onBatchEnd(batch, logs) {
  //   console.log("Accuracy", logs.acc);
  // }
  // const m2 = await model.fit(data, labels, {
  //   epochs: 5,
  //   batchSize: 32,
  //   callbacks: { onBatchEnd },
  // });
  // const prediction = model.predict(tf.randomNormal([3, 784]));
  // const a = prediction.print();
  // console.log("tf.js", "a", await prediction.data());
  // return m2;
}

// trainModel();
// function* data() {
//   for (let i = 0; i < 100; i++) {
//     // Generate one sample at a time.
//     yield tf.randomNormal([784]);
//   }
// }

// function* labels() {
//   for (let i = 0; i < 100; i++) {
//     // Generate one sample at a time.
//     yield tf.randomUniform([10]);
//   }
// }

// const xs = tf.data.generator(data);
// const ys = tf.data.generator(labels);
// // We zip the data and labels together, shuffle and batch 32 samples at a time.
// const ds = tf.data.zip({ xs, ys }).shuffle(100 /* bufferSize */).batch(32);

// // Train the model for 5 epochs.
// model.fitDataset(ds, { epochs: 5 }).then((info) => {
//   console.log("Accuracy", info.history.acc);
// });

// Predict 3 random samples.

const loadModel = async function () {
  const pathName = "file://" + path.join(__dirname, "./aapljs/model.json");
  console.log("tf.js", "pathname", pathName);
  const model = await tf.loadLayersModel(pathName);
  console.log("tf.js", "loaded");
  //------------------------------------------------
  const apipath = `https://api.twelvedata.com/complex_data?apikey=${apiKey}`;
  const apiget = `https://api.twelvedata.com/time_series?symbol=AAPL&outputsize=1000&interval=30min&apikey=${apiKey}`;
  const res = await axios.get(apiget);

  stockDataRaw.push(...res.data.values);
  stockDataRaw.reverse();
  console.log("tf.js", "raw data", stockDataRaw);
  stockData.push(...stockDataRaw.flatMap((u) => u.close));

  console.log("tf.js", "stock length", stockData.length);
  console.log("tf.js", "stock data", stockData);

  stockDataScaled.push(...sc.fit_transform(stockData));

  // predict 10 price
  const predict_10 = async function () {
    console.log("tf.js", "waiting...");
    predictedData = [];
    for (let i = 0; i < 10; i++) {
      // get 1000 values latest
      console.log("tf.js", "prepare data");
      const input_data = stockData.concat(predictedData);
      const input_data_scaled = sc.transform(input_data);
      const len = input_data_scaled.length;
      const input_data_slice_scaled = input_data_scaled.slice(len - 1000, len);

      console.log("tf.js", "predicting...");
      const predict_value_scaled = await model
        .predict(tf.tensor(input_data_slice_scaled, [1, 1000, 1]))
        .array();
      // console.log("tf.js", "predictValue", predict_value_scaled);
      // predictDataScaled.push(predict_value_scaled);

      const predict_value = sc.inverse_transform(predict_value_scaled);
      predictedData.push(...predict_value);
      console.log("tf.js", "predicted: ", predict_value);
    }
  };
  await predict_10();

  console.log("tf.js", "stockData length ", stockData.length);
  console.log("tf.js", "predicted value ", predictedData);

  const client = new ws.WebSocket(
    `wss://ws.twelvedata.com/v1/quotes/price?apikey=${apiKey}`
  );

  const wss = new ws.WebSocketServer({
    path: "/ws",
    port: 8080,
    perMessageDeflate: {
      zlibDeflateOptions: {
        // See zlib defaults.
        chunkSize: 1024,
        memLevel: 7,
        level: 3,
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      // Other options settable:
      clientNoContextTakeover: true, // Defaults to negotiated value.
      serverNoContextTakeover: true, // Defaults to negotiated value.
      serverMaxWindowBits: 10, // Defaults to negotiated value.
      // Below options specified as default values.
      concurrencyLimit: 10, // Limits zlib concurrency for perf.
      threshold: 1024, // Size (in bytes) below which messages
      // should not be compressed if context takeover is disabled.
    },
  });

  const listclient = [];

  client.on("open", function open() {
    console.log("tf.js", "opened");
    client.send(
      JSON.stringify({
        action: "subscribe",
        params: {
          symbols: "AAPL",
        },
      })
    );
  });

  const NUM_MINUTE_PREDICT = 1;

  const lastdateString = stockDataRaw[stockDataRaw.length - 1].datetime;
  console.log("tf.js", "lastdateString ", lastdateString);
  let timestamp = new Date(lastdateString).getTime() / 1000;
  console.log("tf.js", "timestamp", timestamp);
  client.on("message", async function message(data) {
    const obj = JSON.parse(data);
    if (obj.timestamp) {
      console.log("tf.js", "diff", obj.timestamp - timestamp);
      if (obj.timestamp - timestamp >= NUM_MINUTE_PREDICT * MINUTE) {
        timestamp = obj.timestamp;

        const date = new Date(timestamp * 1000);
        console.log("tf.js", "date");

        stockDataRaw.push({ close: obj.price, datetime: date.toDateString() });
        stockData.push(obj.price);

        await predict_10();

        console.log("tf.js", "stockData length ", stockData.length);
        console.log("tf.js", "predicted value ", predictedData);
        if (listclient.length > 0) {
          listclient.forEach((ws) => {
            ws.send(
              JSON.stringify({
                type: "new",
                stock: stockDataRaw.slice(
                  stockDataRaw.length - 40,
                  stockDataRaw.length
                ),
                predict: {
                  price: predictedData,
                  interval: NUM_MINUTE_PREDICT,
                },
              })
            );
          });
        }
      }
    }

    console.log("tf.js", "data ", obj);
  });

  wss.on("connection", (ws) => {
    ws.on("message", function message(data) {
      console.log("received: %s", data);
      if (data.type && data.type == "all") {
        ws.send(
          JSON.stringify({
            type: "all",
            stock: stockDataRaw,
            predict: predictedData,
          })
        );
      }
    });
    listclient.push(ws);
    ws.send(
      JSON.stringify({
        type: "init",
        stock: stockDataRaw,
        predict: predictedData,
      })
    );
  });

  return model;
};
loadModel();
