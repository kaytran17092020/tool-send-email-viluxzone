const cloud = require("../cloud-store");
const { queueHelpers } = require("../indexAI");

module.exports = cloud.queue.handleNodeCallback(async (message) => {
  if (message?.probe === true) {
    await cloud.recordQueueProbe();
    console.info("mail queue probe processed");
    if (message.wake !== true) return;
  }
  console.info("mail queue wake received");
  try { return await cloud.deliver(queueHelpers); }
  catch (error) {
    console.error("mail queue delivery failed", { name: error.name || "Error", code: error.code || "WORKER_ERROR" });
    throw error;
  }
}, {
  retry(error, metadata) {
    if (metadata.deliveryCount > 5) return { acknowledge: true };
    return { afterSeconds: 60 };
  },
});

