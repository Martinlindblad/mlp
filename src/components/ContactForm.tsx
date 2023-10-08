import ChatBubbles from './ContactChatBubbles';
import ContactImage from './ContactImage';
import Form from './Form';
import FormHeader from './FormHeader';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import SocialMediaLinks from './SocialMediaLinks';

const ContactForm = () => {
  return (
    <div className="lg:container pt-6 lg:pt-0">
      <AnimatedFadeInContainer type="FadeInBottom">
        <div className="pt-0 pl-32 lg:pt-6">
          <SocialMediaLinks />
        </div>
        <section className="relative w-full h-full grid grid-cols-12">
          <div className="col-span-9 col-start-3 lg:pt-20 pt-10">
            <FormHeader />
          </div>

          <div className="col-span-12 lg:col-span-5 pt-10">
            <Form />
          </div>

          <div className="col-span-12 lg:col-span-6 lg:col-start-7 relative ">
            <ContactImage />
            <ChatBubbles />
          </div>
        </section>
      </AnimatedFadeInContainer>
    </div>
  );
};

export default ContactForm;
