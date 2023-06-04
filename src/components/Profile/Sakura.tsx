import { useEffect, useState } from 'react';

const Sakura = () => {
  const [sakura, setSakura] = useState<boolean>(false);

  const sakuraFall = () => {
    setSakura(Math.random() >= 0.5);
  };

  useEffect(() => {
    const interval = setInterval(sakuraFall, 38000);

    return () => {
      clearInterval(interval);
    };
  }, []);

  const numRand = Array.from({ length: 60 }, () =>
    Math.floor(Math.random() * 60).toString(),
  );

  return (
    <section key={String(sakura)} className="sakura-container">
      {numRand.map((xPos, key) => (
        <div
          style={{ right: `${xPos}%` }}
          key={key}
          className="sakura-leaf"
        ></div>
      ))}
    </section>
  );
};

export default Sakura;
