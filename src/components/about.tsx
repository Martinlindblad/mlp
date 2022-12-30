import { useEffect, useState } from 'react';
import { AboutType } from 'src/../types/DBTypes';
export default function About() {
  const [introduction, setIntroduction] = useState<AboutType>();

  useEffect(() => {
    void (async () => {
      const results = await fetch('/api/introduction').then((response) =>
        response.json(),
      );
      setIntroduction(results[0]);
    })();
  }, []);

  return (
    <main className="flex justify-center items-center w-full min-h-full ≈">
      <div className="min-w-full pt-32">
        <div className="flex justify-center min-w-full flex-col items-center">
          <h1 className="p-1 text-start text-4xl tracking-widest ">
            {introduction?.name}
          </h1>
          <h1 className="p-1 text-4xl tracking-widest">
            {introduction?.surname}
          </h1>
        </div>
        <div className="justify-center items-center w-full flex pt-10 pb-5 ">
          <div className=" border rounded-full w-52 h-52 overflow-hidden pl-7 pt-7 bg-gradient-to-r from-indigo-900 via-purple-400 to-pink-500">
            <div className=" bg-[url('../../assets/profilepicture.png')] bg-cover w-36 h-52 -rotate-12 rounded-lg" />
          </div>
        </div>
        <h2 className="pt-10 px-6 text-xl text-center font-['Righteous']">
          {introduction?.title}
        </h2>
        <p className="p-3 pb-20 mx-auto text-center">{introduction?.info}</p>
      </div>
    </main>
  );
}
