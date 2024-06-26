"use client";

import * as z from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/Form";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { ToastAction } from "@/components/ui/Toast";

import { Loader2 } from "lucide-react";

import { toast } from "@/hooks/use-toast";

const formSchema = z.object({
  name: z.string().min(2, {
    message: "Name must be at least 2 characters.",
  }),
  phoneNumber: z
    .number()
    .refine((value) => value.toString().length === 8, {
      path: ["phoneNumber"],
      message: "Phone number must be 8 digits.",
    })
    .or(z.string().min(8, "Phone number must be 8 digits.")),
  email: z.string().email({
    message: "Invalid email address.",
  }),
  message: z.string().refine((value) => value.split(" ").length >= 2, {
    message: "Please provide a message with at least 2 words.",
  }),
});

export default function ContactForm() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const form = useForm<z.infer<typeof formSchema>>({
    // @ts-ignore: Random Z Error
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      email: "",
      message: "",
      phoneNumber: "",
    },
  });

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true);

    try {
      await fetch("/api/", {
        method: "POST",
        body: JSON.stringify({
          ...values,
          token: process.env.NEXT_PUBLIC_JWT_SECRET,
        }),
      })
        .then((response) => {
          if (response.status === 200) {
            toast({
              title: "Message Received",
              description: `Thank you, ${values.name}! Your message has been received. We will get back to you soon at ${values.email}.`,
            });
            form.reset();
          } else {
            toast({
              variant: "destructive",
              title: "Hey, are you a robot?",
              description: "You're moving so fast, it's hard to keep up! Let's slow down a bit and try again later. Don't worry, we still love you whether you're human or bot!",
              action: (
                <ToastAction
                  onClick={
                    () => router.refresh()
                  }
                  altText="Try again" >
                  Wait for a bit.
                </ ToastAction>
              ),
            });
          }
        })
        .catch((error) => {
          toast({
            variant: "destructive",
            title: "Uh oh! Something went wrong.",
            description: error,
            action: (
              <ToastAction altText="Try again">
                <Link href="/contact">Try again</Link>
              </ToastAction>
            ),
          });
        });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Uh oh! Something went wrong.",
        description: error.message,
        action: (
          <ToastAction altText="Try again">
            <Link href="/contact">Try again</Link>
          </ToastAction>
        ),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="max-w-[600px] py-8">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-4 md:space-y-0 md:grid md:grid-cols-2 md:gap-2">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="Name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phoneNumber"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Input placeholder="Phone number" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Input placeholder="E-mail" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="message"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <Textarea placeholder="Your message" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {isLoading ? (
            <Button
              disabled={true}
              className="flex justify-center items-center w-full transition-colors bg-cyan-800/40 dark:bg-cyan-600/40 font-semibold text-white hover:text-black dark:hover:text-white shadow-sm hover:bg-cyan-950/20 dark:hover:bg-cyan-600/60"
            >
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Please wait ...
            </Button>
          ) : (
            <Button
              type="submit"
              className="block w-full transition-colors bg-cyan-800/40 dark:bg-cyan-600/40 font-semibold text-white hover:text-black dark:hover:text-white shadow-sm hover:bg-cyan-950/20 dark:hover:bg-cyan-600/60"
            >
              Let's talk
            </Button>
          )}
        </form>
      </Form>
    </div>
  );
}
