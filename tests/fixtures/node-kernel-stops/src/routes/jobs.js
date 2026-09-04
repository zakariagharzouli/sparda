/* eslint-disable */
function JobsHandler() {
  this.runJob = (req, res, next) => {
    // inert: the language and the response surface must NOT become boundaries
    console.log('running', JSON.stringify(req.params));
    Math.max(1, 2);

    // unresolved-alias: a bare call with no local or imported binding
    scheduleWork(req.params.jobId);

    // opaque-callback: a continuation handed to a callee that did not resolve
    withRetries(req.params.jobId, (err) => next(err));

    // dynamic-member: the method name is not statically readable
    const op = req.body.op;
    queueClient[op](req.params.jobId);

    // unresolved-queue: the other end of the producer/consumer pair is not static
    eventBus.emit('job.started', req.params.jobId);

    // unresolved-receiver: neither an import, an instance, nor a captured binding
    mysteryService.lookup(req.params.jobId);

    // unreachable-capture: the class declaring this instance cannot be opened
    const orphan = new GlobalRegistry();
    orphan.register(req.params.jobId);

    return res.json({ ok: true });
  };
}

module.exports = JobsHandler;
