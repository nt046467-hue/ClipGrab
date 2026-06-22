import { Queue as BullQueue } from 'bullmq';
import IORedis from 'ioredis';
import { execSync } from 'child_process';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Parse host and port
let redisHost = '127.0.0.1';
let redisPort = 6379;
try {
  const url = new URL(redisUrl);
  redisHost = url.hostname || '127.0.0.1';
  redisPort = url.port ? parseInt(url.port, 10) : 6379;
} catch (e) {
  // Ignore
}

// Synchronous check if Redis is active
export let isRedis = false;
try {
  const output = execSync('netstat -ano', { timeout: 1000, encoding: 'utf8' });
  isRedis = output.includes(`:${redisPort} `) || output.includes(`.${redisPort} `);
} catch (e) {
  isRedis = false;
}

console.log(`[Queue System] Redis status on ${redisHost}:${redisPort}: ${isRedis ? 'ACTIVE' : 'INACTIVE (Using In-Memory fallback)'}`);

// Implement in-memory mock for Queue, Job, and Worker
export class InMemoryJob {
  id: string;
  data: any;
  progress: number = 0;
  status: 'waiting' | 'active' | 'completed' | 'failed' = 'waiting';
  returnvalue: any = null;
  failedReason: string | null = null;

  constructor(id: string, data: any) {
    this.id = id;
    this.data = data;
  }

  async getState() {
    return this.status;
  }

  async updateProgress(progress: number) {
    this.progress = progress;
  }
}

class InMemoryQueue {
  private jobs: Map<string, InMemoryJob> = new Map();
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  async add(name: string, data: any, opts?: { jobId?: string }) {
    const jobId = opts?.jobId || Math.random().toString();
    const job = new InMemoryJob(jobId, data);
    this.jobs.set(jobId, job);
    
    // Asynchronously process the job
    InMemoryWorker.processJob(this.name, job);
    return job;
  }

  async getJob(jobId: string) {
    return this.jobs.get(jobId) || null;
  }
}

export class InMemoryWorker {
  private static workers: Map<string, (job: any) => Promise<any>> = new Map();
  private static completedCallbacks: ((job: any) => void)[] = [];
  private static failedCallbacks: ((job: any, err: Error) => void)[] = [];

  constructor(name: string, processor: (job: any) => Promise<any>, opts?: any) {
    InMemoryWorker.workers.set(name, processor);
  }

  static async processJob(queueName: string, job: InMemoryJob) {
    // Wait a brief moment to simulate queuing delay
    await new Promise(resolve => setTimeout(resolve, 100));

    const processor = this.workers.get(queueName);
    if (!processor) {
      console.warn(`[InMemoryWorker] No worker registered for queue: ${queueName}`);
      return;
    }

    job.status = 'active';
    try {
      const result = await processor(job);
      job.status = 'completed';
      job.returnvalue = result;
      // Trigger completed callbacks
      this.completedCallbacks.forEach(cb => cb(job));
    } catch (err: any) {
      job.status = 'failed';
      job.failedReason = err.message || 'Unknown error';
      // Trigger failed callbacks
      this.failedCallbacks.forEach(cb => cb(job, err));
    }
  }

  on(event: 'completed' | 'failed', callback: (...args: any[]) => void) {
    if (event === 'completed') {
      InMemoryWorker.completedCallbacks.push(callback);
    } else if (event === 'failed') {
      InMemoryWorker.failedCallbacks.push(callback);
    }
    return this;
  }
}

// Conditional Exports
export let connection: any = null;
export let downloadQueue: any;
export let Queue: any;
export let Worker: any;

if (isRedis) {
  connection = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });
  downloadQueue = new BullQueue('downloads', { connection });
  Queue = BullQueue;
  const { Worker: BullWorker } = require('bullmq');
  Worker = BullWorker;
} else {
  downloadQueue = new InMemoryQueue('downloads');
  Queue = InMemoryQueue;
  Worker = InMemoryWorker;
}

export type Job = any;
