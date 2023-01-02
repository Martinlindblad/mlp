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
    <main className="flex justify-center items-center w-full min-h-screen">
      <div className="min-w-full pt-22">
        <div className="flex justify-center min-w-full flex-col items-center">
          <h1 className="p-1 text-start text-4xl  font-black uppercase fw tracking-widest ">
            {introduction?.name}
          </h1>
          <h1 className="p-1 text-4xl  font-black uppercase fw tracking-widest">
            {introduction?.surname}
          </h1>
        </div>
        <div className=" w-full flex pt-10 pb-5 ">
          <div className="w-full h-72">
            <div className="w-full h-72 bg-[url('../../assets/singapore.jpg')] bg-cover bg-center blur-sm absolute p-10" />

            <div className=" w-full h-72">
              <div className=" relative w-full h-full flex items-center flex-col justify-start pt-4">
                <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full shadow-gold-100 shadow-md  bg-cover h-52 w-52 " />
                <div className=" border rounded-r-3xl bg-transparent absolute left-0 bottom-0">
                  <h2 className="p-1 px-2 text-xl font-['Righteous']">
                    {introduction?.title}
                  </h2>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="p-3 pb-20 mx-auto text-center">{introduction?.info}</p>
      </div>
    </main>
  );
}
