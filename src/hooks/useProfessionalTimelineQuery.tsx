import axios from 'axios';
import { useQuery } from 'react-query';
import { ProfessionalTimeline } from 'src/types/DBTypes';

const getProfessionalTimeline = () =>
  axios
    .get<ProfessionalTimeline[]>(`/api/professionalTimeline`, {
      headers: {
        accept: 'application/json',
      },
    })
    .then(({ data }) => {
      return data;
    })
    .catch((err: unknown) => console.log(err));

const useProfessionalTimeline = () => {
  return useQuery(['getProfessionalTimeline'], () => getProfessionalTimeline());
};

export default useProfessionalTimeline;
