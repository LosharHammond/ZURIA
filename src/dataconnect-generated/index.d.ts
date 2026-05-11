import { ConnectorConfig, DataConnect, QueryRef, QueryPromise, ExecuteQueryOptions, MutationRef, MutationPromise, DataConnectSettings } from 'firebase/data-connect';

export const connectorConfig: ConnectorConfig;
export const dataConnectSettings: DataConnectSettings;

export type TimestampString = string;
export type UUIDString = string;
export type Int64String = string;
export type DateString = string;




export interface Client_Key {
  id: UUIDString;
  __typename?: 'Client_Key';
}

export interface CreateNewProjectData {
  project_insert: Project_Key;
}

export interface CreateNewProjectVariables {
  clientId: UUIDString;
  name: string;
  status: string;
  startDate: DateString;
  description?: string | null;
  endDate?: DateString | null;
  budget?: number | null;
}

export interface GetMyTasksData {
  tasks: ({
    id: UUIDString;
    description: string;
    status: string;
    dueDate: DateString;
    priority?: string | null;
    project: {
      name: string;
      client: {
        name: string;
      };
    };
  } & Task_Key)[];
}

export interface Invoice_Key {
  id: UUIDString;
  __typename?: 'Invoice_Key';
}

export interface ListAllClientsData {
  clients: ({
    id: UUIDString;
    name: string;
    email: string;
    phoneNumber?: string | null;
    industry?: string | null;
    createdAt: TimestampString;
  } & Client_Key)[];
}

export interface Project_Key {
  id: UUIDString;
  __typename?: 'Project_Key';
}

export interface Service_Key {
  id: UUIDString;
  __typename?: 'Service_Key';
}

export interface Task_Key {
  id: UUIDString;
  __typename?: 'Task_Key';
}

export interface UpdateInvoiceStatusData {
  invoice_update?: Invoice_Key | null;
}

export interface UpdateInvoiceStatusVariables {
  id: UUIDString;
  status: string;
}

export interface User_Key {
  id: UUIDString;
  __typename?: 'User_Key';
}

interface ListAllClientsRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<ListAllClientsData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<ListAllClientsData, undefined>;
  operationName: string;
}
export const listAllClientsRef: ListAllClientsRef;

export function listAllClients(options?: ExecuteQueryOptions): QueryPromise<ListAllClientsData, undefined>;
export function listAllClients(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<ListAllClientsData, undefined>;

interface CreateNewProjectRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: CreateNewProjectVariables): MutationRef<CreateNewProjectData, CreateNewProjectVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: CreateNewProjectVariables): MutationRef<CreateNewProjectData, CreateNewProjectVariables>;
  operationName: string;
}
export const createNewProjectRef: CreateNewProjectRef;

export function createNewProject(vars: CreateNewProjectVariables): MutationPromise<CreateNewProjectData, CreateNewProjectVariables>;
export function createNewProject(dc: DataConnect, vars: CreateNewProjectVariables): MutationPromise<CreateNewProjectData, CreateNewProjectVariables>;

interface GetMyTasksRef {
  /* Allow users to create refs without passing in DataConnect */
  (): QueryRef<GetMyTasksData, undefined>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect): QueryRef<GetMyTasksData, undefined>;
  operationName: string;
}
export const getMyTasksRef: GetMyTasksRef;

export function getMyTasks(options?: ExecuteQueryOptions): QueryPromise<GetMyTasksData, undefined>;
export function getMyTasks(dc: DataConnect, options?: ExecuteQueryOptions): QueryPromise<GetMyTasksData, undefined>;

interface UpdateInvoiceStatusRef {
  /* Allow users to create refs without passing in DataConnect */
  (vars: UpdateInvoiceStatusVariables): MutationRef<UpdateInvoiceStatusData, UpdateInvoiceStatusVariables>;
  /* Allow users to pass in custom DataConnect instances */
  (dc: DataConnect, vars: UpdateInvoiceStatusVariables): MutationRef<UpdateInvoiceStatusData, UpdateInvoiceStatusVariables>;
  operationName: string;
}
export const updateInvoiceStatusRef: UpdateInvoiceStatusRef;

export function updateInvoiceStatus(vars: UpdateInvoiceStatusVariables): MutationPromise<UpdateInvoiceStatusData, UpdateInvoiceStatusVariables>;
export function updateInvoiceStatus(dc: DataConnect, vars: UpdateInvoiceStatusVariables): MutationPromise<UpdateInvoiceStatusData, UpdateInvoiceStatusVariables>;

