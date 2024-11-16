import { expect } from 'chai';
import * as sinon from 'sinon';
import * as k8s from '@kubernetes/client-node';
import { PodRestartMonitor } from '../src/podmonitor';
import { IncomingMessage } from 'http';

describe('PodRestartMonitor', () => {
  let podMonitor: PodRestartMonitor;
  let sandbox: sinon.SinonSandbox;
  let k8sApiStub: sinon.SinonStubbedInstance<k8s.CoreV1Api>;

  beforeEach(() => {
    // Set up environment variables
    process.env.NAMESPACE = 'test-namespace';
    process.env.MONITOR_PODS = 'pod1,pod2,pod3';
    process.env.MAX_RESTARTS = '2';

    sandbox = sinon.createSandbox();
    k8sApiStub = sandbox.createStubInstance(k8s.CoreV1Api);
    
    
    

    podMonitor = new PodRestartMonitor();
    (podMonitor as any).k8sApi = k8sApiStub;
  });

  afterEach(() => {
    sandbox.restore();
    delete process.env.NAMESPACE;
    delete process.env.MONITOR_PODS;
    delete process.env.MAX_RESTARTS;
  });

  describe('monitorPodRestarts', () => {
    it('should handle pods with restarts below threshold', async () => {
      const response: Partial<IncomingMessage> = {};
      const containerStatuses :Partial<k8s.V1ContainerStatus> = {'restartCount' : 1}
      const podstatus :Partial<k8s.V1PodStatus>= {
                   containerStatuses: [containerStatuses as k8s.V1ContainerStatus]
      }
      const pod1: Partial<k8s.V1Pod> = {
        metadata: { name: 'pod1' },
        status: podstatus
      };

      k8sApiStub.listNamespacedPod.resolves({
        response: response as IncomingMessage,
        body: { items: [pod1 as k8s.V1Pod] }
      });

      const deleteStub = sandbox.stub(podMonitor as any, 'deletePod');
      await podMonitor.monitorPodRestarts();

      expect(deleteStub.called).to.be.false;
    });

    it('should delete pod when restart count exceeds threshold', async () => {
        const response: Partial<IncomingMessage> = {};
        const containerStatuses :Partial<k8s.V1ContainerStatus> = {'restartCount' : 3}
        const podstatus :Partial<k8s.V1PodStatus>= {
                     containerStatuses: [containerStatuses as k8s.V1ContainerStatus]
        }
        const pod1: Partial<k8s.V1Pod> = {
          metadata: { name: 'pod1' },
          status: podstatus
        };

      k8sApiStub.listNamespacedPod.resolves({
        response: response as IncomingMessage,
        body: { items: [pod1] }
      });

      const deleteStub = sandbox.stub(podMonitor as any, 'deletePod');
      await podMonitor.monitorPodRestarts();

      expect(deleteStub.calledOnce).to.be.true;
      expect(deleteStub.calledWith('pod1')).to.be.true;
    });

    it('should handle API errors gracefully', async () => {
      k8sApiStub.listNamespacedPod.rejects(new Error('API error'));
      
      const consoleErrorStub = sandbox.stub(console, 'error');
      await podMonitor.monitorPodRestarts();

      expect(consoleErrorStub.calledOnce).to.be.true;
    });

    it('should ignore pods not in monitor list', async () => {
        const response: Partial<IncomingMessage> = {};
        const containerStatuses :Partial<k8s.V1ContainerStatus> = {'restartCount' : 3}
        const podstatus :Partial<k8s.V1PodStatus>= {
                     containerStatuses: [containerStatuses as k8s.V1ContainerStatus]
        }
        const pod1: Partial<k8s.V1Pod> = {
          metadata: { name: 'other-pod' },
          status: podstatus
        };

      k8sApiStub.listNamespacedPod.resolves({
        response: response as IncomingMessage,
        body: { items: [pod1] }
      });

      const deleteStub = sandbox.stub(podMonitor as any, 'deletePod');
      await podMonitor.monitorPodRestarts();

      expect(deleteStub.called).to.be.false;
    });
  });

  describe('deletePod', () => {
    it('should successfully delete pod', async () => {
      const podName = 'pod1';
      k8sApiStub.deleteNamespacedPod.resolves();

      const consoleLogStub = sandbox.stub(console, 'log');
      await (podMonitor as any).deletePod(podName);

      expect(k8sApiStub.deleteNamespacedPod.calledOnce).to.be.true;
      expect(k8sApiStub.deleteNamespacedPod.calledWith(podName, 'test-namespace')).to.be.true;
      expect(consoleLogStub.calledWith(`Successfully deleted pod ${podName} in namespace test-namespace`)).to.be.true;
    });

    it('should handle delete errors gracefully', async () => {
      const podName = 'pod1';
      k8sApiStub.deleteNamespacedPod.rejects(new Error('Delete error'));

      const consoleErrorStub = sandbox.stub(console, 'error');
      await (podMonitor as any).deletePod(podName);

      expect(consoleErrorStub.calledOnce).to.be.true;
    });
  });
});
