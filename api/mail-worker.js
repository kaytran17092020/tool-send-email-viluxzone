const cloud = require("../cloud-store");
const { queueHelpers } = require("../indexAI");

module.exports = cloud.queue.handleNodeCallback(async (message) => {
  if (message?.probe === true) {
    await cloud.recordQueueProbe();
    console.info("mail queue probe processed");
    return;
  }
  console.info("mail queue wake received");
  return cloud.deliver(queueHelpers);
}, {
  retry(error, metadata) {
    if (metadata.deliveryCount > 5) return { acknowledge: true };
    return { afterSeconds: 60 };
  },
});

