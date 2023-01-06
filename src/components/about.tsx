import { useTheme } from 'next-themes';
import { useEffect, useMemo, useState } from 'react';
import { AboutType } from 'src/../types/DBTypes';
export default function About() {
  const [introduction, setIntroduction] = useState<AboutType>();
  const { systemTheme, theme } = useTheme();
  const currentTheme = useMemo(() => {
    return theme === 'system' ? systemTheme : theme;
  }, [systemTheme, theme]);
  useEffect(() => {
    void (async () => {
      const results = await fetch('/api/introduction').then((response) =>
        response.json(),
      );
      setIntroduction(results[0]);
    })();
  }, []);

  return (
    <main className="flex pt-10 w-full min-h-screen lg:container">
      <div className="min-w-full">
        <div className="flex justify-center min-w-full flex-col items-center">
          <h1 className="p-1 text-start text-4xl  font-black uppercase fw tracking-widest ">
            {introduction?.name}
          </h1>
          <h1 className="p-1 text-4xl  font-black uppercase fw tracking-widest">
            {introduction?.surname}
          </h1>
        </div>
        <div className=" w-full flex pt-10 pb-5 ">
          <div className="w-full h-72 relative ">
            <div className="object-fill w-full h-72  bg-cover bg-center absolute mix-blend-multiply dark:bg-gray-100 bg-gray-500" />
            {currentTheme === 'dark' ? (
              <div className="object-fill w-full h-72 bg-[url('../../assets/singapore.jpg')] bg-cover bg-center absolute mix-blend-multiply" />
            ) : (
              <div className="object-fill w-full h-72 bg-[url('../../assets/beach.jpg')] bg-cover bg-center absolute mix-blend-multiply" />
            )}

            <div className=" relative w-full h-full flex items-center flex-col justify-start pt-4">
              <div className="object-fill h-52 w-52 rounded-full bg-cover bg-center absolute mix-blend-multiple" />
              <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full shadow-gray-100  shadow-lg bg-cover h-52 w-52 object-fill " />
              <div className=" bg-[url('../../assets/profilepicture.png')] rounded-full  absolute mix-blend-multiply dark:bg-gray-100 bg-gray-400  scale-105 bg-cover h-52 w-52 object-fill" />
              <div className="rounded-tr-xl rounded-tl-xl bg-transparent mx-auto">
                <div className="relative  p-1 pt-6 mx-auto">
                  <h2 className="text-center text-xl font-['Righteous'] text-gray-100">
                    {introduction?.title}
                  </h2>
                </div>
              </div>
            </div>
          </div>
        </div>

        <p className="text-lg font-normallg:text-xl ">{introduction?.info}</p>

        <h2 className="mb-4 text-3xl font-extrabold   md:text-5xl lg:text-6xl">
          <span className="text-transparent bg-clip-text bg-gradient-to-r to-emerald-600 from-sky-400">
            Better Data
          </span>{' '}
          Scalable AI.
        </h2>
        <p className="text-lg font-normal  lg:text-xl ">
          Here at Flowbite we focus on markets where technology, innovation, and
          capital can unlock long-term value and drive economic growth.
        </p>
      </div>
    </main>
  );
}
