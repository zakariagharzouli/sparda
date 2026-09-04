const JobsHandler = require('./jobs');

const index = (app) => {
  const jobs = new JobsHandler();
  app.post('/jobs/:jobId', jobs.runJob);
};

module.exports = index;
