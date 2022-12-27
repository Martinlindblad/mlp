/* eslint-disable no-underscore-dangle */
import { useEffect, useState } from 'react';
import Head from 'next/head';
import { RestaurantResponseType } from 'src/../types/DBTypes';

export default function Home() {
  const [restaurants, setRestaurants] = useState<RestaurantResponseType[]>([]);
  console.log('restaurants', restaurants);

  useEffect(() => {
    void (async () => {
      const results = await fetch('/api/list').then((response) =>
        response.json(),
      );
      console.log(results);
      setRestaurants(results);
    })();
  }, []);

  return (
    <div className="flex">
      <Head>
        <title>Create Next App</title>
        <meta name="description" content="Generated by create next app" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <main>
        <h1 className="h-5">
          MongoDB with <a href="https://nextjs.org">Next.js!</a> Example
        </h1>
        <br />
        <div className="grid-flow-row">
          {restaurants.map((restaurant: any) => (
            <div key={restaurant._id}>
              <h2>{restaurant.name}</h2>
              <p>{restaurant.address.street}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
