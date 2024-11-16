import { expect } from 'chai';
import * as sinon from 'sinon';
import * as ping from 'ping';
import { WorkerMonitor } from '../src/index';

describe('WorkerMonitor Ping Functionality', () => {
  let workerMonitor: WorkerMonitor;
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    // Set up environment variables
    process.env.NAMESPACE = 'test-namespace';
    process.env.NODE_NAME = 'worker-1';
    process.env.WORKER1_IP = '192.168.1.1';
    process.env.WORKER2_IP = '192.168.1.2';
    process.env.WORKER3_IP = '192.168.1.3';
    process.env.WORKER1_NAME = 'worker-1';
    process.env.WORKER2_NAME = 'worker-2';
    process.env.WORKER3_NAME = 'worker-3';

    sandbox = sinon.createSandbox();
    workerMonitor = new WorkerMonitor();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('pingWorker', () => {
    it('should handle successful ping and update worker state', async () => {
      const pingResult : ping.PingResponse = { alive: true, min: "1",max: "1",inputHost:" ",host:" ",output:" ",avg:"2",time:2,times:[1.0,1.0],stddev:" ",packetLoss:"0.0"};
      sandbox.stub(ping.promise, 'probe').resolves(pingResult);

      const monitor = workerMonitor as any;
      const result = await monitor.pingWorker('192.168.1.2', 'worker-2');

      expect(result).to.be.true;
      expect(monitor.connectedWorkers.has('worker-2')).to.be.true;
      expect(monitor.workerStates['worker-2'].isDown).to.be.false;
    });

    it('should handle failed ping and update worker state', async () => {
      const pingResult : ping.PingResponse = { alive: false, min: "1",max: "1",inputHost:" ",host:" ",output:" ",avg:"2",time:2,times:[1.0,1.0],stddev:" ",packetLoss:"0.0"};
      sandbox.stub(ping.promise, 'probe').resolves(pingResult);

      const monitor = workerMonitor as any;
      const result = await monitor.pingWorker('192.168.1.2', 'worker-2');

      expect(result).to.be.false;
      expect(monitor.connectedWorkers.has('worker-2')).to.be.false;
    });

    it('should handle ping errors gracefully', async () => {
      sandbox.stub(ping.promise, 'probe').rejects(new Error('Network error'));

      const monitor = workerMonitor as any;
      const result = await monitor.pingWorker('192.168.1.2', 'worker-2');

      expect(result).to.be.false;
      expect(monitor.connectedWorkers.has('worker-2')).to.be.false;
    });

    it('should reset worker state when reconnected after being down', async () => {
      const monitor = workerMonitor as any;
      monitor.workerStates['worker-2'].isDown = true;
      monitor.workerStates['worker-2'].podsDeleted = true;
      monitor.workerStatus.set('worker-2', 3);

      const pingResult : ping.PingResponse = { alive: true, min: "1",max: "1",inputHost:" ",host:" ",output:" ",avg:"2",time:2,times:[1.0,1.0],stddev:" ",packetLoss:"0.0"};
      sandbox.stub(ping.promise, 'probe').resolves(pingResult);

      await monitor.pingWorker('192.168.1.2', 'worker-2');

      expect(monitor.workerStates['worker-2'].isDown).to.be.false;
      expect(monitor.workerStates['worker-2'].podsDeleted).to.be.false;
      expect(monitor.workerStatus.has('worker-2')).to.be.false;
    });
  });
});
