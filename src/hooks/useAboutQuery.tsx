import axios from 'axios';
import { useQuery } from 'react-query';
import {
  PersonalInfo,
  ProfessionalProfileKeys,
  ProfessionalProfileDataByKey,
} from 'src/types/DBTypes';

const getpersonalInfo = (
  informationType: keyof typeof ProfessionalProfileKeys,
) =>
  axios
    .get<PersonalInfo[]>(`/api/introduction`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      const dataByType = data.find(
        (item) => item.key === informationType,
      ) as unknown as ProfessionalProfileDataByKey<typeof informationType>;
      return dataByType;
    })
    .catch((err: unknown) => {
      console.log(err);
      return undefined;
    });

const useAboutQuery = (
  informationType: keyof typeof ProfessionalProfileKeys,
) => {
  return useQuery(['getpersonalInfo', informationType], () =>
    getpersonalInfo(informationType),
  );
};

export default useAboutQuery;
