import { expect } from 'chai';
import * as sinon from 'sinon';
import * as k8s from '@kubernetes/client-node';
import { WorkerMonitor } from '../src/index';

describe('WorkerMonitor', () => {
  //let workerMonitor: WorkerMonitor;
  let sandbox: sinon.SinonSandbox;
  //let k8sApiStub: sinon.SinonStubbedInstance<k8s.CoreV1Api>;

  beforeEach(() => {
    // Set up test environment variables
    process.env.NAMESPACE = 'test-namespace';
    process.env.NODE_NAME = 'worker-1';
    process.env.WORKER1_IP = '192.168.1.1';
    process.env.WORKER2_IP = '192.168.1.2';
    process.env.WORKER3_IP = '192.168.1.3';
    process.env.WORKER1_NAME = 'worker-1';
    process.env.WORKER2_NAME = 'worker-2';
    process.env.WORKER3_NAME = 'worker-3';
    process.env.READ_K8S_CONFIG_FILE = 'false';
    process.env.PING_INTERVAL_SECONDS = '3';

    sandbox = sinon.createSandbox();
    
    // Create stub for k8s API
    //k8sApiStub = sandbox.createStubInstance(k8s.CoreV1Api);
    
    // Stub KubeConfig
    const kubeConfigStub = sandbox.stub(k8s.KubeConfig.prototype);
    kubeConfigStub.loadFromCluster = sandbox.stub();
    kubeConfigStub.loadFromDefault = sandbox.stub();
    
    // Fix: Properly type the makeApiClient stub
    /*kubeConfigStub.makeApiClient = sandbox.stub().callsFake(function <T extends k8s.ApiType>(
      _apiClientType: k8s.ApiConstructor<T>
    ): T {
      return k8sApiStub as any as T;
    });*/
  });

  afterEach(() => {
    sandbox.restore();
    // Clear environment variables
    delete process.env.NAMESPACE;
    delete process.env.NODE_NAME;
    delete process.env.WORKER1_IP;
    delete process.env.WORKER2_IP;
    delete process.env.WORKER3_IP;
    delete process.env.WORKER1_NAME;
    delete process.env.WORKER2_NAME;
    delete process.env.WORKER3_NAME;
    delete process.env.READ_K8S_CONFIG_FILE;
    delete process.env.PING_INTERVAL_SECONDS;
  });

  describe('Constructor', () => {
    it('should initialize with default values when environment variables are missing', () => {
      // Clear all environment variables
      const envBackup = { ...process.env };
      process.env = {};
      process.env.WORKER1_IP = '192.168.1.1';
      process.env.WORKER2_IP = '192.168.1.2';
      process.env.WORKER3_IP = '192.168.1.3';

      console.log("WORKER1_IP = ${process.env.WORKER1_IP}")

      const monitor = new WorkerMonitor();
      const monitorAny = monitor as any;

      expect(monitorAny.namespace).to.equal('');
      expect(monitorAny.pingIntervalSeconds).to.equal(3);
      expect(monitorAny.maxFailures).to.equal(3);
      expect(monitorAny.currentNodeName).to.equal('');

      // Restore environment variables
      process.env = envBackup;
    });

    it('should throw error when worker IPs are not provided', () => {
      delete process.env.WORKER1_IP;
      
      expect(() => new WorkerMonitor()).to.throw(Error);
    });

    it('should initialize worker states correctly', () => {
      const workerMonitor = new WorkerMonitor();
      const monitorAny = workerMonitor as any;
      expect(monitorAny.workerStates).to.deep.equal({
        'worker-1': { isDown: false, podsDeleted: false },
        'worker-2': { isDown: false, podsDeleted: false },
        'worker-3': { isDown: false, podsDeleted: false }
      });
    });
  });

  describe('Pod Deletion Permission', () => {
    describe('canDeletePods', () => {
      it('should allow worker-1 to delete pods when it has connected workers', () => {
        const workerMonitor = new WorkerMonitor();
        const monitor = workerMonitor as any;
        monitor.currentNodeName = 'worker-1';
        monitor.connectedWorkers = new Set(['worker-2']);
        expect(monitor.canDeletePods()).to.be.true;
      });

      it('should not allow worker-1 to delete pods when it has no connected workers', () => {
        const workerMonitor = new WorkerMonitor();
        const monitor = workerMonitor as any;
        monitor.currentNodeName = 'worker-1';
        monitor.connectedWorkers = new Set();
        expect(monitor.canDeletePods()).to.be.false;
      });

      it('should allow worker-2 to delete pods when it has connected workers', () => {
        const workerMonitor = new WorkerMonitor();
        const monitor = workerMonitor as any;
        monitor.currentNodeName = 'worker-2';
        monitor.connectedWorkers = new Set(['worker-3']);
        expect(monitor.canDeletePods()).to.be.true;
      });

      it('should allow worker- to delete pods when the disconnect worker is not worker 1', () => {
        const workerMonitor = new WorkerMonitor();
        const monitor = workerMonitor as any;
        monitor.currentNodeName = 'worker-1';
        monitor.connectedWorkers = new Set(['worker-1']);
        expect(monitor.shouldHandleWorkerDeletion('worker-1')).to.be.false;
      });

      it('should not allow worker-3 to delete pods under any circumstances', () => {
        const workerMonitor = new WorkerMonitor();
        const monitor = workerMonitor as any;
        monitor.currentNodeName = 'worker-3';
        monitor.connectedWorkers = new Set(['worker-1', 'worker-2']);
        expect(monitor.canDeletePods()).to.be.false;
      });
    });

    describe('shouldHandleWorkerDeletion', () => {
      it('should allow worker-1 to handle worker-2 and worker-3 deletions when connected', () => {
        const workerMonitor = new WorkerMonitor();
        const monitor = workerMonitor as any;
        monitor.currentNodeName = 'worker-1';
        monitor.connectedWorkers = new Set(['worker-2']);
        
        expect(monitor.shouldHandleWorkerDeletion('worker-2')).to.be.true;
        expect(monitor.shouldHandleWorkerDeletion('worker-3')).to.be.true;
      });

      it('should not allow worker-1 to handle deletions when not connected', () => {
        const workerMonitor = new WorkerMonitor();
        const monitor = workerMonitor as any;
        monitor.currentNodeName = 'worker-1';
        monitor.connectedWorkers = new Set();
        
        expect(monitor.shouldHandleWorkerDeletion('worker-2')).to.be.false;
        expect(monitor.shouldHandleWorkerDeletion('worker-3')).to.be.false;
      });

      it('should allow worker-2 to handle only worker-1 deletions when connected', () => {
        const workerMonitor = new WorkerMonitor();
        const monitor = workerMonitor as any;
        monitor.currentNodeName = 'worker-2';
        monitor.connectedWorkers = new Set(['worker-3']);
        
        expect(monitor.shouldHandleWorkerDeletion('worker-1')).to.be.true;
        expect(monitor.shouldHandleWorkerDeletion('worker-3')).to.be.false;
      });

      it('should not allow worker-3 to handle any deletions', () => {
        const workerMonitor = new WorkerMonitor();
        const monitor = workerMonitor as any;
        monitor.currentNodeName = 'worker-3';
        monitor.connectedWorkers = new Set(['worker-1', 'worker-2']);
        
        expect(monitor.shouldHandleWorkerDeletion('worker-1')).to.be.false;
        expect(monitor.shouldHandleWorkerDeletion('worker-2')).to.be.false;
      });
      // Add this test case to the Constructor describe block in worker-monitor-main-test.spec.ts

  
    });
  });
});

describe('WorkerMonitor K8s Configuration', () => {
  let sandbox: sinon.SinonSandbox;
  

  beforeEach(() => {
    // Set up required environment variables
    process.env.WORKER1_IP = '192.168.1.1';
    process.env.WORKER2_IP = '192.168.1.2';
    process.env.WORKER3_IP = '192.168.1.3';
    
    sandbox = sinon.createSandbox();
   
  });

  afterEach(() => {
    sandbox.restore();
    delete process.env.WORKER1_IP;
    delete process.env.WORKER2_IP;
    delete process.env.WORKER3_IP;
    delete process.env.READ_K8S_CONFIG_FILE;
    delete process.env.K8S_CONFIG_FILE;
  });

  it('should load from file when k8sHasFile is true', () => {
    process.env.READ_K8S_CONFIG_FILE = 'true';
    process.env.K8S_CONFIG_FILE = '/custom/path/config';

    const mockKubeConfig = new k8s.KubeConfig();
    const loadFromFileStub = sinon.stub(mockKubeConfig, 'loadFromFile') as sinon.SinonStub;
    const makeApiClientStub = sinon.stub(mockKubeConfig, 'makeApiClient').returns({} as any);
    mockKubeConfig.loadFromFile = loadFromFileStub;
    mockKubeConfig.makeApiClient = makeApiClientStub as <T extends k8s.ApiType>(apiClientType: any) => T;


    new WorkerMonitor(mockKubeConfig);

    expect(loadFromFileStub.calledOnce).to.be.true;
    expect(loadFromFileStub.calledWith('/custom/path/config')).to.be.true;
  });

  it('should load from cluster when k8sHasFile is false', () => {
    process.env.READ_K8S_CONFIG_FILE = 'false';

    const mockKubeConfig = new k8s.KubeConfig();
    const loadFromClusterStub = sinon.stub(mockKubeConfig, 'loadFromCluster') as sinon.SinonStub;
    const makeApiClientStub = sinon.stub(mockKubeConfig, 'makeApiClient').returns({} as any);

    mockKubeConfig.loadFromCluster = loadFromClusterStub;
    mockKubeConfig.makeApiClient = makeApiClientStub as <T extends k8s.ApiType>(apiClientType: any) => T;

    new WorkerMonitor(mockKubeConfig);

    expect(loadFromClusterStub.calledOnce).to.be.true;
  });

  it('should load from default when loading from cluster fails', () => {
    process.env.READ_K8S_CONFIG_FILE = 'false';

    const mockKubeConfig = new k8s.KubeConfig();
    const loadFromClusterStub = sandbox.stub(mockKubeConfig, 'loadFromCluster').throws(new Error('Cluster load failed'));
    const loadFromDefaultStub = sandbox.stub(mockKubeConfig, 'loadFromDefault');
    sandbox.stub(mockKubeConfig, 'makeApiClient').returns({} as any);

    new WorkerMonitor(mockKubeConfig);

    expect(loadFromClusterStub.calledOnce).to.be.true;
    expect(loadFromDefaultStub.calledOnce).to.be.true;
  });
});

