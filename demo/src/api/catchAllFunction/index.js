module.exports = async function (context, req) {
  context.log('JavaScript HTTP trigger function processed a request.');
  // You can call and await an async method here
  return {
      body: "Hello, world!"
  };
}