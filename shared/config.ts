export interface ProjectConfig {
  title: string;
  projectIds: string[];
}

export interface FleetConfig {
  projects: ProjectConfig[];
}
