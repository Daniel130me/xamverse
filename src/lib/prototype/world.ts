/**
 * DemoWorld — the complete simulated multi-device environment.
 * Each device owns an independent DeviceLocalState. Data only propagates
 * through the simulated sync engine — never automatically.
 */
import type {
  AcademicSession,
  ApprovalRequest,
  Assessment,
  ClassRoom,
  ConflictCase,
  Department,
  Device,
  DeviceLocalState,
  ExamAttempt,
  ExamPackage,
  Question,
  Role,
  RoleDefinition,
  School,
  SubmissionRecord,
  Subject,
  TopicNode,
  User,
} from './types';

export interface DemoWorld {
  version: number;
  createdAt: string;
  schools: Record<string, School>;
  sessions: AcademicSession[];
  classes: Record<string, ClassRoom>;
  departments: Department[];
  subjects: Record<string, Subject>;
  topics: TopicNode[];
  users: Record<string, User>;
  roleDefinitions: RoleDefinition[];
  devices: Record<string, Device>;
  /** per-device independent local state */
  locals: Record<string, DeviceLocalState>;
  network: {
    lanOnline: boolean;
    scanEnabled: boolean;
  };
  /** id of the current exam scenario assessment (created during demo) */
  scenario: {
    mainAssessmentId: string | null;
    createdAssessmentId: string | null;
    distributionDone: boolean;
    collectionDone: boolean;
  };
}

export interface ActiveSession {
  userId: string;
  deviceId: string;
  startedAt: string;
  locked: boolean;
  source: 'desktop' | 'browser';
}

/** The singleton demo world + UI state kept in the store */
export interface DemoState {
  world: DemoWorld;
  activeDeviceId: string;
  session: ActiveSession | null;
  booted: boolean;
  onboarded: boolean;
}
