const cloud = require("../cloud-store");
const { queueHelpers } = require("../index");

module.exports = cloud.queue.handleNodeCallback(async () => cloud.deliver(queueHelpers), {
  retry(error, metadata) {
    if (metadata.deliveryCount > 5) return { acknowledge: true };
    return { afterSeconds: 60 };
  },
});
