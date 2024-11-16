import * as k8s from '@kubernetes/client-node';
import * as ping from 'ping';
import { PodRestartMonitor } from './podmonitor';
// Removed unused os import

const parseBoolean = (value: string): boolean => value === 'true';

interface WorkerState {
    isDown: boolean;
    podsDeleted: boolean;
}

interface WorkerStates {
    [key: string]: WorkerState;
}

interface WorkerIps {
    [key: string]: string;
}

interface WorkerNames {
    [key: string]: string;
}

export class WorkerMonitor {
    private kc: k8s.KubeConfig;
    private k8sApi: k8s.CoreV1Api;
    private namespace: string;
    private pingIntervalSeconds: number;
    private maxFailures: number;
    private workerStatus: Map<string, number>;
    private currentNodeName: string;
    private workerStates: WorkerStates;
    private workerIps: WorkerIps;
    private workrname: WorkerNames;
    private k8sHasFile: boolean = false; // Initialize with default value
    private k8scofigfile: string = 'C:\\Users\\User\\.kube\\config'; // Initialize with default value
    private connectedWorkers: Set<string>;

    constructor(KubeConfig? :k8s.KubeConfig ) {
        // Initialize properties
        this.k8sHasFile = parseBoolean(process.env.READ_K8S_CONFIG_FILE || 'false');
        this.k8scofigfile = process.env.K8S_CONFIG_FILE || 'C:\\Users\\User\\.kube\\config';
        
        // Initialize Kubernetes client
        if (KubeConfig)
           this.kc = KubeConfig;
        else
          this.kc = new k8s.KubeConfig();
        try {
            if (this.k8sHasFile) {
                this.kc.loadFromFile(this.k8scofigfile);
            } else {
                this.kc.loadFromCluster();
            }
        } catch (error) {
            this.kc.loadFromDefault();
        }

        this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
        
        // Configuration
        this.namespace = process.env.NAMESPACE || '';
        this.pingIntervalSeconds = parseInt(process.env.PING_INTERVAL_SECONDS || '3');
        this.maxFailures = 3;
        this.workerStatus = new Map();
        this.currentNodeName = process.env.NODE_NAME || '';
        
        // Track worker states
        this.workerStates = {
            'worker-1': { isDown: false, podsDeleted: false },
            'worker-2': { isDown: false, podsDeleted: false },
            'worker-3': { isDown: false, podsDeleted: false }
        };
        
        // Get worker IPs from environment variables
        this.workerIps = {
            'worker-1': process.env.WORKER1_IP || '',
            'worker-2': process.env.WORKER2_IP || '',
            'worker-3': process.env.WORKER3_IP || ''
        };

        this.workrname = {
            'worker-1': process.env.WORKER1_NAME || '',
            'worker-2': process.env.WORKER2_NAME || '',
            'worker-3': process.env.WORKER3_NAME || ''
        };

        console.log(`k8sHasFile val is ${this.k8sHasFile} and load from ${this.k8scofigfile}`);

        // Validate worker IPs
        Object.entries(this.workerIps).forEach(([worker, ip]) => {
            if (!ip) {
                throw new Error(`IP address for ${worker} not provided in environment variables`);
            }
        });
        
        // Track connectivity status
        this.connectedWorkers = new Set<string>();
        
        console.log(`Monitor running on node: ${this.currentNodeName}`);
        console.log(`Monitoring namespace: ${this.namespace}`);
        console.log(`Ping interval: ${this.pingIntervalSeconds} seconds`);
        console.log('Worker IPs:', this.workerIps);
    }

    private canDeletePods(): boolean {
        if (this.currentNodeName === 'worker-1') {
            return this.connectedWorkers.size > 0;
        } else if (this.currentNodeName === 'worker-2') {
            return this.connectedWorkers.size > 0;
        }
        return false;
    }

    private shouldHandleWorkerDeletion(workerName: string): boolean {
        if (!this.canDeletePods()) {
            return false;
        }

        if (this.currentNodeName === 'worker-1') {
            return workerName === 'worker-2' || workerName === 'worker-3';
        } else if (this.currentNodeName === 'worker-2') {
            return workerName === 'worker-1';
        }
        return false

    }

    private async pingWorker(workerIp: string, workerName: string): Promise<boolean> {
        try {
            const result = await ping.promise.probe(workerIp, {
                timeout: 2,
                extra: ['-c', '2']
            });

            console.log(result.alive);
            
            if (result.alive) {
                this.connectedWorkers.add(workerName);
                console.log(`Ping successful to ${workerName} (${workerIp})`);
                console.log(`Ping statistics - min/avg/max: ${result.min}/${result.avg}/${result.max} ms`);
                
                // If worker was down and is now up, reset its state
                if (this.workerStates[workerName].isDown) {
                    console.log(`Worker ${workerName} has reconnected!`);
                    this.workerStates[workerName].isDown = false;
                    this.workerStates[workerName].podsDeleted = false;
                    this.workerStatus.delete(workerName);
                }
                
                return true;
            }
            
            console.error(`Ping failed to ${workerName} (${workerIp})`);
            this.connectedWorkers.delete(workerName);
            return false;
        } catch (error) {
            console.error(`Error pinging ${workerName} (${workerIp}):`, error instanceof Error ? error.message : String(error));
            this.connectedWorkers.delete(workerName);
            return false;
        }
    }

    private async deletePodsOnWorker(workerName: string): Promise<void> {
        if (this.workerStates[workerName].podsDeleted) {
            console.log(`Pods already deleted for ${workerName} during this down period. Waiting for reconnection...`);
            return;
        }

        try {
            const pods = await this.k8sApi.listNamespacedPod(this.namespace);
            
            const podsToDelete = pods.body.items.filter(
                pod => pod.spec?.nodeName === this.workrname[workerName] // Added optional chaining
            );

            if (podsToDelete.length === 0) {
                console.log(`No pods found running on ${this.workrname[workerName]}`);
                return;
            }

            console.log(`Found ${podsToDelete.length} pods to delete on ${workerName}`);

            for (const pod of podsToDelete) {
                try {
                    await this.k8sApi.deleteNamespacedPod(
                        pod.metadata?.name || '',
                        this.namespace
                    );
                    console.log(`Successfully deleted pod ${pod.metadata?.name} from ${this.workrname[workerName]}`);
                } catch (error) {
                    console.error(`Error deleting pod ${pod.metadata?.name}:`, error instanceof Error ? error.message : String(error));
                }
            }

            this.workerStates[workerName].podsDeleted = true;
            this.workerStates[workerName].isDown = true;
            console.log(`Marked ${workerName} as down and pods deleted. Will not delete pods again until worker reconnects.`);
            
        } catch (error) {
            console.error(`Error deleting pods on worker ${workerName}:`, error instanceof Error ? error.message : String(error));
        }
    }

    public async monitorWorkers(): Promise<void> {
        while (true) {
            this.connectedWorkers.clear();
            
            for (const [workerName] of Object.entries(this.workerIps)) {
                if (workerName === this.currentNodeName) {
                    continue;
                }

                const isHealthy = await this.pingWorker(this.workerIps[workerName], workerName);

                if (!isHealthy) {
                    const currentFailures = (this.workerStatus.get(workerName) || 0) + 1;
                    this.workerStatus.set(workerName, currentFailures);

                    console.warn(
                        `Worker ${workerName} failed health check ` +
                        `(${currentFailures}/${this.maxFailures})`
                    );
                }
            }

            for (const [workerName] of Object.entries(this.workerIps)) {
                if (workerName === this.currentNodeName) {
                    continue;
                }

                const currentFailures = this.workerStatus.get(workerName);
                if (currentFailures !== undefined && 
                    currentFailures >= this.maxFailures && 
                    this.shouldHandleWorkerDeletion(workerName)) {
                    console.error(
                        `Worker ${workerName} exceeded maximum failures. ` +
                        `Monitor on ${this.currentNodeName} will delete all pods...`
                    );
                    await this.deletePodsOnWorker(workerName);
                }
            }

            console.log('Current worker states:', JSON.stringify(this.workerStates, null, 2));
            console.log(`Connected workers: ${Array.from(this.connectedWorkers).join(', ')}`);
            console.log(`Can delete pods: ${this.canDeletePods()}`);

            await new Promise(resolve => 
                setTimeout(resolve, this.pingIntervalSeconds * 1000)
            );
        }
    }
}

// Error handling for uncaught exceptions
process.on('uncaughtException', (error: Error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start the monitor
async function main(): Promise<void> {
    const runmain = parseBoolean(process.env.RUN_MAIN || 'false')
    if (!runmain)
        return
    const workerMonitor = new WorkerMonitor();
    const podMonitor = new PodRestartMonitor();
    
    await Promise.all([
        workerMonitor.monitorWorkers(),
        podMonitor.startMonitoring()
    ]);
   

}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
