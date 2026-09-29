import axios from 'axios';
import yayson from 'yayson';
import {
  StatusEntity,
  StatusRawData,
} from '@/entities/StatusEntity';

const { Store } = yayson();

export class StatusRepository {
  public constructor(
    private readonly httpClient = axios,
  ) {}

  public async getStatusData(): Promise<StatusEntity | null> {
    const { data: result } = await this.httpClient.get(
      `${process.env.NEXT_PUBLIC_API_URL}/status`,
    );
    if (result) {
      // The status resource carries no id, which sync() refuses.
      const data = Store.build(result) as unknown as StatusRawData;
      if (data) {
        return new StatusEntity(data);
      }
    }
    return null;
  }
}
