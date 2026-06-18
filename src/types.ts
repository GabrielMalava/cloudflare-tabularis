export interface ConnectionParams {
  driver?: string | null;
  host?: string | null;
  port?: number | null;
  database?: string | null;
  username?: string | null;
  password?: string | null;
  ssl_mode?: string | null;
}

export interface TableInfo {
  name: string;
}

export interface TableColumn {
  name: string;
  data_type: string;
  is_pk: boolean;
  is_nullable: boolean;
  is_auto_increment: boolean;
  default_value?: string;
  character_maximum_length?: number;
}

export interface ForeignKey {
  name: string;
  column_name: string;
  ref_table: string;
  ref_column: string;
  on_delete?: string | null;
  on_update?: string | null;
}

export interface IndexInfo {
  name: string;
  column_name: string;
  is_unique: boolean;
  is_primary: boolean;
  seq_in_index: number;
}

export interface Pagination {
  page: number;
  page_size: number;
  total_rows: number | null;
  has_more: boolean;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  affected_rows: number;
  truncated: boolean;
  pagination: Pagination | null;
}

export interface ViewInfo {
  name: string;
  definition?: string | null;
}

export interface TableSchema {
  name: string;
  columns: TableColumn[];
  foreign_keys: ForeignKey[];
}

export interface ColumnDefinition {
  name: string;
  data_type: string;
  is_nullable: boolean;
  is_pk: boolean;
  is_auto_increment: boolean;
  default_value?: string | null;
}
