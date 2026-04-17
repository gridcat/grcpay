import axios from 'axios';
import yayson from 'yayson';

const { Store } = yayson();

export interface Rate {
  id?: string | number;
  currency: string;
  price: number;
}

export class RatesRepository {
  public constructor(
    private readonly httpClient = axios,
  ) {}

  public async getAllRates(): Promise<Rate[]> {
    const { data: result } = await this.httpClient.get(
      `${process.env.NEXT_PUBLIC_API_URL}/rates`,
    );
    const store = new Store();
    const parsed = store.sync(result) as Rate[] | null;
    return parsed ?? [];
  }

  public async getRate(currency: string): Promise<Rate | null> {
    const { data: result } = await this.httpClient.get(
      `${process.env.NEXT_PUBLIC_API_URL}/rates/${currency}`,
    );
    const store = new Store();
    const parsed = store.sync(result) as Rate | null;
    return parsed;
  }
}
