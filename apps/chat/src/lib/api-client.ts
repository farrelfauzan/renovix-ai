import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type AxiosRequestConfig,
  type CreateAxiosDefaults,
} from "axios";
import { toast } from "sonner";
import { config } from "./config";

export interface TypedAxiosInstance extends AxiosInstance {
  get<T = any, R = T>(url: string, config?: AxiosRequestConfig): Promise<R>;
  delete<T = any, R = T>(url: string, config?: AxiosRequestConfig): Promise<R>;
  post<T = any, R = T>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<R>;
  put<T = any, R = T>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<R>;
  patch<T = any, R = T>(
    url: string,
    data?: any,
    config?: AxiosRequestConfig,
  ): Promise<R>;
}

const axiosConfig: CreateAxiosDefaults = {
  baseURL: config.apiUrl,
  timeout: 30000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
  paramsSerializer: {
    serialize: (params: Record<string, any>) => {
      const searchParams = new URLSearchParams();

      Object.entries(params).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          if (key === "status" && value.length > 0) {
            searchParams.append(key, value.join(","));
          } else {
            value.forEach((item) => {
              if (item !== undefined && item !== null) {
                searchParams.append(key, String(item));
              }
            });
          }
        } else if (value !== undefined && value !== null) {
          searchParams.append(key, String(value));
        }
      });

      return searchParams.toString();
    },
  },
};

export const apiClient: TypedAxiosInstance = axios.create(axiosConfig);

apiClient.interceptors.response.use(
  (response: AxiosResponse) => response.data,
  (error: AxiosError) => {
    const status = error.response?.status;
    const message =
      (error.response?.data as Record<string, any>)?.message ||
      error.message ||
      "An unexpected error occurred";

    if (status === 401) {
      toast.error("Session expired. Please log in again.");
    } else if (status === 403) {
      toast.error("You do not have permission to perform this action.");
    } else if (status && status >= 500) {
      toast.error("Server error. Please try again later.");
    } else if (status && status >= 400) {
      toast.error(message);
    }

    return Promise.reject(error);
  },
);

export default apiClient;
