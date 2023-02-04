import { useEffect, useState } from 'react';
import dayjs from 'dayjs';
import { IntroductionType } from 'src/../types/DBTypes';
export default function About() {
  const [introduction, setIntroduction] = useState<IntroductionType>();

  useEffect(() => {
    void (async () => {
      const results = await fetch('/api/introduction').then((response) =>
        response.json(),
      );
      setIntroduction(results[0]);
    })();
  }, []);

  return (
    <main className="min-h-screen flex flex-col justify-center items-center ">
      <div className="container max-w-3xl p-6 mb-4 bg-slate-300 rounded-3xl">
        <p className="py-6">{introduction?.introduction}</p>
        <p>{introduction?.description}</p>
        <div className="containe row flex py-6">
          <p>{introduction?.name}</p>
          <p>{dayjs(introduction?.from).format('YYYY MM DD').toString()}</p>-
          {introduction?.from ? <p>{dayjs().format('YYYY MM DD')}</p> : null}
        </div>
      </div>

      <div className="bg-slate-100 container w-auto p-3 rounded-lg">
        <h5 className="h-4 border-l-fuchsia-500  white pb-6 flex">
          Go to <a href={introduction?.link}>{introduction?.name}!</a>
        </h5>
      </div>
    </main>
  );
}
