import { expect } from 'chai';
import * as sinon from 'sinon';
import * as k8s from '@kubernetes/client-node';
import { WorkerMonitor } from '../src/index';
import { IncomingMessage } from 'http';
import * as ping from 'ping';


describe('WorkerMonitor Pod Management', () => {
  let workerMonitor: WorkerMonitor;
  let sandbox: sinon.SinonSandbox;
  let k8sApiStub: sinon.SinonStubbedInstance<k8s.CoreV1Api>;

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
    
    // Create stub for k8s API
    k8sApiStub = sandbox.createStubInstance(k8s.CoreV1Api);
    
    // Stub KubeConfig
    const kubeConfigStub = sandbox.stub(k8s.KubeConfig.prototype);
    kubeConfigStub.loadFromCluster = sandbox.stub();
    kubeConfigStub.loadFromDefault = sandbox.stub();
    //kubeConfigStub.makeApiClient = sandbox.stub().returns(k8sApiStub);

    workerMonitor = new WorkerMonitor();
  });

  afterEach(() => {
    sandbox.restore();
    // Clean up environment variables
    delete process.env.NAMESPACE;
    delete process.env.NODE_NAME;
    delete process.env.WORKER1_IP;
    delete process.env.WORKER2_IP;
    delete process.env.WORKER3_IP;
    delete process.env.WORKER1_NAME;
    delete process.env.WORKER2_NAME;
    delete process.env.WORKER3_NAME;
  });

  describe('deletePodsOnWorker', () => {
    it('should not delete pods if already deleted for current down period', async () => {
      const monitor = workerMonitor as any;
      monitor.workerStates['worker-2'].podsDeleted = true;

      await monitor.deletePodsOnWorker('worker-2');
      
      expect(k8sApiStub.listNamespacedPod.called).to.be.false;
    });

    it('should handle empty pod list', async () => {
      const monitor = workerMonitor as any;
      const response:Partial<IncomingMessage> ={} ;
      k8sApiStub.listNamespacedPod.resolves({
        response:response as IncomingMessage,
        body: {
          items: []
        }
      });

      await monitor.deletePodsOnWorker('worker-2');
      
      expect(monitor.workerStates['worker-2'].podsDeleted).to.be.false;
      expect(k8sApiStub.deleteNamespacedPod.called).to.be.false;
    });

    it('should delete all pods on the specified worker', async () => {
      const monitor = workerMonitor as any;
      const spec1: Partial<k8s.V1PodSpec>= {nodeName: 'worker-2'};
      const response:Partial<IncomingMessage> ={} ;
      const pods = [
        { metadata: { name: 'pod1' }, spec: spec1 as k8s.V1PodSpec },
        { metadata: { name: 'pod2' }, spec: spec1 as k8s.V1PodSpec }
      ];
     
      k8sApiStub.listNamespacedPod.resolves({
        response:response as IncomingMessage,
        body: {
          items: pods
        }
      });

      monitor.k8sApi = k8sApiStub as k8s.CoreV1Api;

      await monitor.deletePodsOnWorker('worker-2');
      
      expect(k8sApiStub.deleteNamespacedPod.callCount).to.equal(2);
      expect(monitor.workerStates['worker-2'].podsDeleted).to.be.true;
      expect(monitor.workerStates['worker-2'].isDown).to.be.true;
    });

    it('should handle pod deletion errors gracefully', async () => {
      const monitor = workerMonitor as any;
      const spec1: Partial<k8s.V1PodSpec>= {nodeName: 'worker-2'};
      const response:Partial<IncomingMessage> ={} ;
      const pods = [
        { metadata: { name: 'pod1' }, spec:spec1 as k8s.V1PodSpec  }
      ];

      k8sApiStub.listNamespacedPod.resolves({
        response:response as IncomingMessage,
        body: {
          items: pods
        }
      });
      k8sApiStub.deleteNamespacedPod.rejects(new Error('Deletion failed'));
      monitor.k8sApi = k8sApiStub as k8s.CoreV1Api;
      await monitor.deletePodsOnWorker('worker-2');
      
      expect(monitor.workerStates['worker-2'].podsDeleted).to.be.true;
      expect(monitor.workerStates['worker-2'].isDown).to.be.true;
    });

    it('should handle list pods API errors gracefully', async () => {
      const monitor = workerMonitor as any;
      k8sApiStub.listNamespacedPod.rejects(new Error('API error'));
      monitor.k8sApi = k8sApiStub as k8s.CoreV1Api; 
      await monitor.deletePodsOnWorker('worker-2');
      
      expect(monitor.workerStates['worker-2'].podsDeleted).to.be.false;
      expect(monitor.workerStates['worker-2'].isDown).to.be.false;
    });

    it('should ignore pods on different workers', async () => {
      const monitor = workerMonitor as any;
      const spec1: Partial<k8s.V1PodSpec>= {nodeName: 'worker-2'};
      const spec2: Partial<k8s.V1PodSpec>= {nodeName: 'worker-3'};
     
      const response:Partial<IncomingMessage> ={} ;
      const pods = [
        { metadata: { name: 'pod1' }, spec:spec1 as k8s.V1PodSpec  },
        { metadata: { name: 'pod2' }, spec:spec2 as k8s.V1PodSpec  }
      ];

      k8sApiStub.listNamespacedPod.resolves({
        response:response as IncomingMessage,
        body: {
          items: pods
        }
      });
      monitor.k8sApi = k8sApiStub as k8s.CoreV1Api;
      await monitor.deletePodsOnWorker('worker-2');
      
      expect(k8sApiStub.deleteNamespacedPod.callCount).to.equal(1);
      expect(k8sApiStub.deleteNamespacedPod.firstCall.args[0]).to.equal('pod1');
    });
  });

  describe('canDeletePods', () => {
    it('should allow worker-1 to delete pods when connected to at least one worker', () => {
      const monitor = workerMonitor as any;
      monitor.currentNodeName = 'worker-1';
      monitor.connectedWorkers.add('worker-2');
      
      expect(monitor.canDeletePods()).to.be.true;
    });

    it('should not allow worker-1 to delete pods when not connected to any workers', () => {
      const monitor = workerMonitor as any;
      monitor.currentNodeName = 'worker-1';
      monitor.connectedWorkers.clear();
      
      expect(monitor.canDeletePods()).to.be.false;
    });

    it('should allow worker-2 to delete pods when connected to at least one worker', () => {
      const monitor = workerMonitor as any;
      monitor.currentNodeName = 'worker-2';
      monitor.connectedWorkers.add('worker-1');
      
      expect(monitor.canDeletePods()).to.be.true;
    });

    it('should not allow worker-3 to delete pods', () => {
      const monitor = workerMonitor as any;
      monitor.currentNodeName = 'worker-3';
      monitor.connectedWorkers.add('worker-1');
      monitor.connectedWorkers.add('worker-2');
      
      expect(monitor.canDeletePods()).to.be.false;
    });
  });

  describe('shouldHandleWorkerDeletion', () => {
    it('should allow worker-1 to handle worker-2 and worker-3 deletions', () => {
      const monitor = workerMonitor as any;
      monitor.currentNodeName = 'worker-1';
      monitor.connectedWorkers.add('worker-3');
      
      expect(monitor.shouldHandleWorkerDeletion('worker-2')).to.be.true;
      expect(monitor.shouldHandleWorkerDeletion('worker-3')).to.be.true;
    });

    it('should allow worker-2 to handle only worker-1 deletions', () => {
      const monitor = workerMonitor as any;
      monitor.currentNodeName = 'worker-2';
      monitor.connectedWorkers.add('worker-3');
      
      expect(monitor.shouldHandleWorkerDeletion('worker-1')).to.be.true;
      expect(monitor.shouldHandleWorkerDeletion('worker-3')).to.be.false;
    });

    it('should not allow worker-3 to handle any deletions', () => {
      const monitor = workerMonitor as any;
      monitor.currentNodeName = 'worker-3';
      monitor.connectedWorkers.add('worker-1');
      monitor.connectedWorkers.add('worker-2');
      
      expect(monitor.shouldHandleWorkerDeletion('worker-1')).to.be.false;
      expect(monitor.shouldHandleWorkerDeletion('worker-2')).to.be.false;
    });

    it('should not allow deletions when no workers are connected', () => {
      const monitor = workerMonitor as any;
      monitor.currentNodeName = 'worker-1';
      monitor.connectedWorkers.clear();
      
      expect(monitor.shouldHandleWorkerDeletion('worker-2')).to.be.false;
      expect(monitor.shouldHandleWorkerDeletion('worker-3')).to.be.false;
    });
  });
  describe('pingWorker', () => {
    let pingStub: sinon.SinonStub;

    beforeEach(() => {
        pingStub = sandbox.stub(ping.promise, 'probe');
    });

    it('should handle successful ping and update worker state', async () => {
        const monitor = workerMonitor as any;
        const workerName = 'worker-2';
        const workerIp = '192.168.1.2';

        // Set initial state as down
        monitor.workerStates[workerName].isDown = true;
        monitor.workerStates[workerName].podsDeleted = true;
        monitor.workerStatus.set(workerName, 3);

        pingStub.resolves({
            alive: true,
            min: '1',
            avg: '2',
            max: '3'
        });

        const result = await monitor.pingWorker(workerIp, workerName);

        expect(result).to.be.true;
        expect(monitor.connectedWorkers.has(workerName)).to.be.true;
        expect(monitor.workerStates[workerName].isDown).to.be.false;
        expect(monitor.workerStates[workerName].podsDeleted).to.be.false;
        expect(monitor.workerStatus.has(workerName)).to.be.false;
        expect(pingStub.calledWith(workerIp, {
            timeout: 2,
            extra: ['-c', '2']
        })).to.be.true;
    });

    it('should handle failed ping', async () => {
        const monitor = workerMonitor as any;
        const workerName = 'worker-2';
        const workerIp = '192.168.1.2';

        pingStub.resolves({
            alive: false
        });

        const result = await monitor.pingWorker(workerIp, workerName);

        expect(result).to.be.false;
        expect(monitor.connectedWorkers.has(workerName)).to.be.false;
    });

    it('should handle ping errors', async () => {
        const monitor = workerMonitor as any;
        const workerName = 'worker-2';
        const workerIp = '192.168.1.2';

        pingStub.rejects(new Error('Network error'));

        const result = await monitor.pingWorker(workerIp, workerName);

        expect(result).to.be.false;
        expect(monitor.connectedWorkers.has(workerName)).to.be.false;
    });
  });
});