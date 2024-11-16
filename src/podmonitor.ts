import * as k8s from '@kubernetes/client-node';

export class PodRestartMonitor {
    private k8sApi: k8s.CoreV1Api;
    private namespace: string;
    private podNames: string[];
    private maxRestarts: number;

    constructor() {
        const kc = new k8s.KubeConfig();
        kc.loadFromDefault();
        this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
        
        // Using the same namespace environment variable
        this.namespace = process.env.NAMESPACE || '';
        this.podNames = (process.env.MONITOR_PODS || '').split(',').map(pod => pod.trim());
        this.maxRestarts = parseInt(process.env.MAX_RESTARTS || '1');
    }

    async monitorPodRestarts(): Promise<void> {
        try {
            // Get pods in the specified namespace
            const pods = await this.k8sApi.listNamespacedPod(this.namespace);
            
            // Filter and check pods that match our list
            for (const pod of pods.body.items) {
                if (this.podNames.includes(pod.metadata?.name || '')) {
                    await this.checkPodRestarts(pod);
                }
            }
        } catch (error) {
            console.error(`Error monitoring pods: ${error}`);
        }
    }

    private async checkPodRestarts(pod: k8s.V1Pod): Promise<void> {
        const podName = pod.metadata?.name || '';
        
        // Check restart count for all containers in the pod
        for (const containerStatus of pod.status?.containerStatuses || []) {
            const restartCount = containerStatus.restartCount || 0;
            
            if (restartCount > this.maxRestarts) {
                console.log(`Pod ${podName} has ${restartCount} restarts. Deleting pod...`);
                await this.deletePod(podName);
                break; // Exit after deleting the pod
            }
        }
    }

    private async deletePod(podName: string): Promise<void> {
        try {
            await this.k8sApi.deleteNamespacedPod(podName, this.namespace);
            console.log(`Successfully deleted pod ${podName} in namespace ${this.namespace}`);
        } catch (error) {
            console.error(`Error deleting pod ${podName}: ${error}`);
        }
    }

    // Method to start continuous monitoring
    async startMonitoring(intervalSeconds: number = 30): Promise<void> {
        console.log(`Starting pod restart monitoring in namespace ${this.namespace}`);
        console.log(`Monitoring pods: ${this.podNames.join(', ')}`);
        
        while (true) {
            await this.monitorPodRestarts();
            await new Promise(resolve => setTimeout(resolve, intervalSeconds * 1000));
        }
    }

} 