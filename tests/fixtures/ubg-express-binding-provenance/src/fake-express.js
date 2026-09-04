function fakeExpress() {
  return {
    get() {},
    post() {},
    use() {},
  };
}

fakeExpress.Router = () => ({ get() {}, post() {}, use() {} });
module.exports = fakeExpress;
