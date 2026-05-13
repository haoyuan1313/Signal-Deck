import http from "http";

const req = http.request("http://localhost:3000/api/balance", { method: "GET" }, (res) => {
  console.log(`STATUS: ${res.statusCode}`);
  res.setEncoding("utf8");
  res.on("data", (chunk) => {
    console.log(`BODY: ${chunk}`);
  });
});

req.on("error", (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.end();
