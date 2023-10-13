import ChatBubbles from './ContactChatBubbles';
import ContactMe from './ContactMe';
import Form from './Form';
import AnimatedFadeInContainer from './Layouts/AnimatedFadeInContainer';
import SocialMediaLinks from './SocialMediaLinks';

const ContactForm = () => {
  return (
    <div
      className="flex items-center justify-center pt-6 lg:pt-0 relative bg-cover bg-top h-screen w-full"
      style={{ backgroundImage: "url('/images/friends.png')" }}
    >
      <div className="lg:container">
        <div className="absolute inset-0 bg-black opacity-80 z-0" />

        <div className="relative z-10 px-4 sm:px-0">
          <AnimatedFadeInContainer type="FadeInBottom">
            <div className="mb-4 lg:mb-0 pl-0 lg:pl-32">
              <SocialMediaLinks />
            </div>
            <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="col-span-9 col-start-3 lg:pt-20 pt-10">
                {/* <FormHeader /> */}
              </div>

              <div className="col-span-12 lg:col-span-5 pt-10">
                <Form />
              </div>

              <div className="col-span-12 lg:col-span-6 lg:col-start-7 relative">
                <ContactMe />
                <ChatBubbles />
              </div>
            </section>
          </AnimatedFadeInContainer>
        </div>
      </div>
    </div>
  );
};

export default ContactForm;
